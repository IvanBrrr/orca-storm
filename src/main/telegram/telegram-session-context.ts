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
  private readonly creatingTopics = new Map<string, Promise<TelegramTopic>>()
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
    }
  }
  request(sessionId: string): void {
    this.requested.add(sessionId)
    this.state.data.replySessions = [...this.requested]
  }
  finishRequest(sessionId: string): void {
    this.requested.delete(sessionId)
    this.state.data.replySessions = [...this.requested]
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
  async document(threadId: number, bytes: Uint8Array, name: string): Promise<void> {
    const owner = this.state.data.ownerId
    if (!owner) {
      throw new Error('Telegram ещё не привязан к владельцу.')
    }
    try {
      await this.client.document(owner, threadId, bytes, name, this.signal)
    } catch (error) {
      if (!(error instanceof TelegramApiError) || !error.topicMissing) {
        throw error
      }
      await this.client.document(
        owner,
        await this.replaceDeletedTopic(threadId),
        bytes,
        name,
        this.signal
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
  async topic(session: TelegramSession): Promise<TelegramTopic> {
    const existing = this.state.data.topics[session.id]
    if (existing) {
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
    const pending = this.creatingTopics.get(session.id)
    if (pending) {
      return pending
    }
    const create = this.createTopic(session)
    this.creatingTopics.set(session.id, create)
    try {
      return await create
    } finally {
      this.creatingTopics.delete(session.id)
    }
  }
  private async createTopic(session: TelegramSession): Promise<TelegramTopic> {
    const owner = this.state.data.ownerId
    if (!owner) {
      throw new Error('Telegram ещё не привязан к владельцу.')
    }
    const name = telegramTopicName(session)
    const history = session.agent === 'codex' ? await this.port.history(session.id) : []
    const result = await this.client.topic(owner, name, this.signal)
    const topic: TelegramTopic = {
      threadId: result.message_thread_id,
      name,
      closed: !session.visible,
      seen: history
        .filter(
          (item) =>
            item.body.kind === 'message' &&
            item.body.role === 'assistant' &&
            item.body.state !== 'running'
        )
        .map((item) => `message:${item.itemId}`),
      lastUpdated: session.updatedAt
    }
    if (session.status?.turnOutcome) {
      this.remember(
        topic,
        `outcome:${session.status.statusStartedAt ?? session.status.updatedAt}:${session.status.turnOutcome}`
      )
    }
    this.state.data.topics[session.id] = topic
    await this.state.save()
    const keyboard = {
      inline_keyboard: [
        [
          this.button('Статус', { kind: 'status', sessionId: session.id }, topic.threadId),
          this.button('Остановить', { kind: 'stop', sessionId: session.id }, topic.threadId)
        ],
        [
          this.button('Все сессии', { kind: 'sessions', page: 0 }, topic.threadId),
          this.button('Новая сессия', { kind: 'workspaces', page: 0 }, topic.threadId)
        ]
      ]
    }
    await this.state.save()
    await this.text(
      topic.threadId,
      `Сессия Storca: ${name}\nАгент: ${session.agent}\n${session.agent === 'codex' ? 'Пиши сюда, чтобы продолжить разговор.' : 'Переписка через Telegram пока поддерживается для Codex.'}${session.source === 'terminal' ? '\nЗапросы разрешений в терминальных сессиях пока нужно подтверждать в Storca.' : ''} /new создаёт новую сессию.`,
      keyboard,
      { silent: true }
    )
    return topic
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
