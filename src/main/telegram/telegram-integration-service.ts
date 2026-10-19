import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import type { TelegramIntegrationStatus } from '../../shared/telegram-integration'
import { TelegramApiError, TelegramBotClient } from './telegram-bot-client'
import type { TelegramIntegrationState } from './telegram-integration-state'
import { TelegramSessionContext } from './telegram-session-context'
import { routeTelegramUpdate } from './telegram-update-router'
import { syncTelegramSessions } from './telegram-session-sync'
import type { TelegramSessionPort } from './telegram-session-port'

export class TelegramIntegrationService {
  private abort: AbortController | null = null
  private running: Promise<void> | null = null
  private connected = false
  private error: string | null = null
  private pairingUrl: string | null = null
  private mutations: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(
    readonly state: TelegramIntegrationState,
    private readonly port: TelegramSessionPort,
    private readonly isAway: () => boolean | undefined,
    private readonly clientFactory: (token: string) => TelegramBotClient = (token) =>
      new TelegramBotClient(token)
  ) {}

  async initialize(): Promise<void> {
    try {
      await this.state.load()
      if (this.state.data.encryptedToken) {
        this.start()
      }
    } catch {
      this.error = 'Не удалось загрузить или расшифровать настройки Telegram. Подключи бота заново.'
    }
  }
  status(): TelegramIntegrationStatus {
    return {
      configured: Boolean(this.state.data.encryptedToken),
      connected: this.connected,
      bot: this.state.data.bot,
      ownerId: this.state.data.ownerId,
      notificationsEnabled: this.state.data.notificationsEnabled,
      pairingUrl:
        this.state.data.pairing && this.state.data.pairing.expiresAt > Date.now()
          ? this.pairingUrl
          : null,
      topicCount: Object.keys(this.state.data.topics).length,
      error: this.error
    }
  }
  configure(tokenInput: string): Promise<TelegramIntegrationStatus> {
    return this.mutate(async () => {
      const token = tokenInput.trim() || this.state.token()
      if (!/^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(token)) {
        throw new Error('Вставь токен бота, полученный от BotFather.')
      }
      const client = this.clientFactory(token)
      const bot = await client.me()
      const webhook = await client.call('getWebhookInfo', {}, z.object({ url: z.string() }))
      if (webhook.url) {
        throw new Error(
          'Этот бот использует webhook. Для Storca создай отдельного бота или отключи webhook.'
        )
      }
      await this.stop()
      if (this.state.data.bot?.id !== bot.id) {
        this.state.reset()
        this.pairingUrl = null
      }
      this.state.setToken(token)
      this.state.data.bot = {
        id: bot.id,
        username: bot.username,
        topicsEnabled: bot.has_topics_enabled === true
      }
      await this.state.save()
      this.error = null
      this.start()
      return this.status()
    })
  }
  pair(): Promise<TelegramIntegrationStatus> {
    return this.mutate(async () => {
      const bot = this.state.data.bot
      if (!bot) {
        throw new Error('Сначала подключи Telegram-бота.')
      }
      const nonce = this.state.beginPairing()
      await this.state.save()
      this.pairingUrl = `https://t.me/${bot.username}?start=${nonce}`
      return this.status()
    })
  }
  setNotifications(enabled: boolean): Promise<TelegramIntegrationStatus> {
    return this.mutate(async () => {
      this.state.data.notificationsEnabled = enabled
      await this.state.save()
      return this.status()
    })
  }
  disconnect(): Promise<TelegramIntegrationStatus> {
    return this.mutate(async () => {
      await this.stop()
      this.state.reset()
      await this.state.save()
      this.pairingUrl = null
      this.error = null
      return this.status()
    })
  }
  async close(): Promise<void> {
    this.closed = true
    this.abort?.abort()
    await this.mutations.catch(() => {})
    await this.stop()
    await this.state.writer.waitForPendingWrite()
  }
  private mutate<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.mutations
      .catch(() => {})
      .then(() => {
        if (this.closed) {
          throw new Error('Storca завершает работу.')
        }
        return work()
      })
    this.mutations = pending
    return pending
  }
  private start(): void {
    if (this.closed || this.running) {
      return
    }
    const abort = new AbortController()
    this.abort = abort
    const client = this.clientFactory(this.state.token())
    this.running = this.run(client, abort.signal).finally(() => {
      this.connected = false
    })
  }
  private async stop(): Promise<void> {
    this.abort?.abort()
    await this.running?.catch(() => {})
    this.running = null
    this.abort = null
    this.connected = false
  }
  private async run(client: TelegramBotClient, signal: AbortSignal): Promise<void> {
    const ctx = new TelegramSessionContext(client, this.state, this.port, signal, this.isAway)
    const sync = this.syncLoop(ctx)
    try {
      let failures = 0
      while (!signal.aborted) {
        try {
          const bot = await client.me(signal)
          this.state.data.bot = {
            id: bot.id,
            username: bot.username,
            topicsEnabled: bot.has_topics_enabled === true
          }
          if (!bot.has_topics_enabled) {
            throw new Error('Включи Threaded Mode для бота в настройках BotFather.')
          }
          this.connected = true
          this.error = null
          await this.state.save()
          while (!signal.aborted) {
            const updates = await client.updates(this.state.data.offset, signal)
            for (const update of updates) {
              signal.throwIfAborted()
              if (update.update_id < this.state.data.offset) {
                continue
              }
              try {
                await routeTelegramUpdate(ctx, update)
              } catch (error) {
                if (
                  signal.aborted ||
                  (error instanceof TelegramApiError && error.code !== 400 && error.code !== 403) ||
                  (error instanceof Error && error.message === 'Нет связи с Telegram.')
                ) {
                  throw error
                }
                const message = update.message ?? update.callback_query?.message
                const sender = update.message?.from ?? update.callback_query?.from
                if (
                  message?.chat.type === 'private' &&
                  message.chat.id === this.state.data.ownerId &&
                  sender?.id === this.state.data.ownerId
                ) {
                  if (error instanceof TelegramApiError) {
                    this.error = error.message
                  }
                  await ctx
                    .text(
                      error instanceof TelegramApiError ? undefined : message.message_thread_id,
                      error instanceof Error && !(error instanceof z.ZodError)
                        ? error.message
                        : 'Не удалось обработать сообщение. Попробуй ещё раз.'
                    )
                    .catch(() => {})
                }
              }
              // Persist before acknowledging getUpdates; session operations use stable update IDs.
              const previousOffset = this.state.data.offset
              this.state.data.offset = update.update_id + 1
              try {
                await this.state.save()
              } catch (error) {
                this.state.data.offset = previousOffset
                throw error
              }
            }
            failures = 0
          }
        } catch (error) {
          if (signal.aborted) {
            break
          }
          this.connected = false
          this.error =
            error instanceof TelegramApiError
              ? error.message
              : error instanceof Error && error.message.startsWith('Включи Threaded Mode')
                ? error.message
                : 'Нет связи с Telegram. Переподключаемся.'
          if (error instanceof TelegramApiError && (error.code === 401 || error.code === 409)) {
            this.abort?.abort()
            break
          }
          const seconds =
            error instanceof TelegramApiError && error.code === 429
              ? Math.min(error.retryAfter, 300)
              : Math.min(2 ** failures++, 30)
          await delay(seconds * 1000, undefined, { signal }).catch(() => {})
        }
      }
    } finally {
      await sync
    }
  }
  private async syncLoop(ctx: TelegramSessionContext): Promise<void> {
    while (!ctx.signal.aborted) {
      try {
        if (this.connected && this.state.data.bot?.topicsEnabled) {
          await syncTelegramSessions(ctx)
          if (this.connected) {
            this.error = null
          }
        }
      } catch (error) {
        if (!ctx.signal.aborted) {
          this.error =
            error instanceof TelegramApiError
              ? error.message
              : 'Не удалось синхронизировать сессии Telegram. Повторяем.'
        }
      }
      await delay(3000, undefined, { signal: ctx.signal }).catch(() => {})
    }
  }
}
