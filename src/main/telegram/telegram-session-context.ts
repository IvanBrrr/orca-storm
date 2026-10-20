import { createTelegramSessionTopic } from './telegram-topic-creation'
import { reserveTelegramTopic, telegramTopicOpenedAt } from './telegram-topic-retention'
import type { TelegramReplyMarkup, TelegramKeyboard } from './telegram-bot-schema'
import type { TelegramBotClient } from './telegram-bot-client'
import { TelegramApiError } from './telegram-bot-client'
import type { TelegramSessionPort, TelegramSession } from './telegram-session-port'
import type {
  TelegramIntegrationState,
  TelegramTopic,
  TelegramAction
} from './telegram-integration-state'

export function telegramTopicName(session: TelegramSession): string {
  const workspace = Array.from(session.workspaceName?.trim() ?? '')
    .slice(0, 64)
    .join('')
  const conversation = session.name.trim() || `Новая сессия ${session.agent}`
  const name = workspace ? `${workspace} · ${conversation}` : conversation
  return Array.from(name).slice(0, 128).join('')
}

export class TelegramSessionContext {
  readonly sessions = new Map<string, TelegramSession>()
  readonly requested = new Set<string>()
  readonly pollingStartedAt = Date.now()
  private topicSerial: Promise<unknown> = Promise.resolve()
  private serial: Promise<unknown> = Promise.resolve()
  wasAway = false

  constructor(
    readonly client: TelegramBotClient,
    readonly state: TelegramIntegrationState,
    readonly port: TelegramSessionPort,
    readonly signal: AbortSignal,
    readonly isAway: () => boolean | undefined
  ) {
    for (const sessionId of state.data.replySessions) {
      this.requested.add(sessionId)
      const topic = state.data.topics[sessionId]
      if (topic) {
        topic.lastOpenedAt ??= Date.now()
      }
    }
  }
  request(sessionId: string, notifyReply = false): void {
    this.requested.add(sessionId)
    this.state.data.replySessions = [...this.requested]
    const topic = this.state.data.topics[sessionId]
    if (topic) {
      topic.lastOpenedAt = telegramTopicOpenedAt(this)
    }
    if (topic && notifyReply) {
      topic.notifyReply = true
    }
  }
  finishRequest(sessionId: string): void {
    this.requested.delete(sessionId)
    this.state.data.replySessions = [...this.requested]
    const topic = this.state.data.topics[sessionId]
    if (topic) {
      topic.notifyReply = false
    }
  }

  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const task = this.serial
      .catch(() => {})
      .then(() => {
        this.signal.throwIfAborted()
        return work()
      })
    this.serial = task
    return task
  }

  async refresh(): Promise<void> {
    const sessions = await this.port.list()
    this.sessions.clear()
    for (const session of sessions) {
      this.sessions.set(session.id, session)
    }
  }
  async text(
    threadId: number | undefined,
    text: string,
    keyboard?: TelegramReplyMarkup,
    options?: { silent?: boolean }
  ): Promise<number> {
    const owner = this.state.data.ownerId
    if (!owner) {
      throw new Error('Telegram ещё не привязан к владельцу.')
    }
    this.signal.throwIfAborted()
    try {
      return await this.client.text(owner, threadId, text, keyboard, this.signal, options)
    } catch (error) {
      if (!(error instanceof TelegramApiError) || !error.topicMissing || !threadId) {
        throw error
      }
      const replacement = await this.replaceDeletedTopic(threadId)
      if (keyboard && 'inline_keyboard' in keyboard) {
        for (const row of keyboard.inline_keyboard) {
          for (const button of row) {
            const action = this.state.data.actions[button.callback_data]
            if (action) {
              action.threadId = replacement
            }
          }
        }
        await this.state.save()
      }
      return this.client.text(owner, replacement, text, keyboard, this.signal, options)
    }
  }
  async document(
    threadId: number,
    bytes: Uint8Array,
    name: string,
    options?: { silent?: boolean }
  ): Promise<void> {
    const owner = this.state.data.ownerId
    if (!owner) {
      throw new Error('Telegram ещё не привязан к владельцу.')
    }
    try {
      await this.client.document(owner, threadId, bytes, name, this.signal, options)
    } catch (error) {
      if (!(error instanceof TelegramApiError) || !error.topicMissing) {
        throw error
      }
      await this.client.document(
        owner,
        await this.replaceDeletedTopic(threadId),
        bytes,
        name,
        this.signal,
        options
      )
    }
  }
  async menu(
    threadId: number | undefined,
    messageId: number | undefined,
    text: string,
    keyboard: TelegramKeyboard
  ): Promise<void> {
    await this.state.save()
    if (messageId && this.state.data.ownerId) {
      try {
        await this.client.editText(this.state.data.ownerId, messageId, text, keyboard, this.signal)
        return
      } catch (error) {
        if (!(error instanceof TelegramApiError)) {
          throw error
        }
        if (error.messageNotModified) {
          return
        }
        if (!error.messageMissing && !error.topicMissing) {
          throw error
        }
      }
    }
    await this.text(threadId, text, keyboard, { silent: true })
  }
  private async replaceDeletedTopic(threadId: number): Promise<number> {
    const entry = Object.entries(this.state.data.topics).find(
      ([, topic]) => topic.threadId === threadId
    )
    const owner = this.state.data.ownerId
    if (!entry || !owner) {
      throw new Error('Тема сессии больше недоступна.')
    }
    const topic = entry[1]
    if (topic.deleting) {
      throw new Error('Тема удаляется. Открой сессию заново через /sessions.')
    }
    const result = await this.client.topic(owner, topic.name, this.signal)
    topic.threadId = result.message_thread_id
    await this.state.save()
    return topic.threadId
  }
  button(text: string, action: TelegramAction, threadId?: number) {
    const identity = ['sessions', 'session-search', 'session-select', 'workspaces'].includes(
      action.kind
    )
      ? `navigation:${threadId ?? 0}:${JSON.stringify(action)}`
      : undefined
    return {
      text: Array.from(text).slice(0, 100).join(''),
      callback_data: this.state.action(action, threadId, identity)
    }
  }
  topic(session: TelegramSession, automatic = false): Promise<TelegramTopic> {
    const task = this.topicSerial.catch(() => {}).then(() => this.openTopic(session, automatic))
    this.topicSerial = task
    return task
  }
  private async openTopic(session: TelegramSession, automatic: boolean): Promise<TelegramTopic> {
    if (
      !automatic ||
      !this.state.data.topics[session.id] ||
      this.state.data.topics[session.id]?.deleting
    ) {
      await reserveTelegramTopic(this, session.id)
    }
    const existing = this.state.data.topics[session.id]
    if (existing) {
      if (!automatic) {
        existing.lastOpenedAt = telegramTopicOpenedAt(this)
        await this.state.save()
      }
      const name = telegramTopicName(session)
      const owner = this.state.data.ownerId
      if (owner && session.visible && existing.name !== name) {
        try {
          await this.client.renameTopic(owner, existing.threadId, name, this.signal)
        } catch (error) {
          if (!(error instanceof TelegramApiError) || !error.topicMissing) {
            throw error
          }
          existing.name = name
          await this.replaceDeletedTopic(existing.threadId)
        }
        existing.name = name
        await this.state.save()
      }
      return existing
    }
    return createTelegramSessionTopic(this, session, automatic)
  }
  sessionForThread(threadId: number | undefined): TelegramSession | undefined {
    if (!threadId) {
      return undefined
    }
    const entry = Object.entries(this.state.data.topics).find(
      ([, topic]) => topic.threadId === threadId
    )
    return entry ? this.sessions.get(entry[0]) : undefined
  }
  identity(updateId: string | number): string {
    return `telegram:${this.state.data.bot?.id}:${updateId}`
  }
  operation(updateId: string | number): Promise<string> {
    return this.state.operation(this.identity(updateId))
  }
  remember(topic: TelegramTopic, key: string): void {
    if (!topic.seen.includes(key)) {
      topic.seen.push(key)
    }
    if (topic.seen.length > 600) {
      topic.seen.splice(0, topic.seen.length - 600)
    }
  }
}
