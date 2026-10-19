import { z } from 'zod'
import { setTimeout as delay } from 'node:timers/promises'
import {
  TelegramBot,
  TelegramUpdate,
  type TelegramKeyboard,
  type TelegramReplyMarkup
} from './telegram-bot-schema'

export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
const API = 'https://api.telegram.org'
const MessageResult = z.object({ message_id: z.number().int() })

export class TelegramApiError extends Error {
  constructor(
    readonly code: number,
    readonly retryAfter: number = 1,
    readonly topicMissing: boolean = false,
    readonly messageMissing: boolean = false,
    readonly messageNotModified: boolean = false
  ) {
    super(
      code === 409
        ? 'Этот бот уже подключён к другой Storca или использует webhook.'
        : code === 401
          ? 'Токен Telegram-бота недействителен.'
          : code === 429
            ? 'Telegram ограничил частоту запросов. Повторяем позже.'
            : `Telegram отклонил запрос (${code}).`
    )
  }
}

export class TelegramBotClient {
  private nextSendAt = 0
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sendIntervalMs = 1000
  ) {}

  async call<T>(
    method: string,
    params: Record<string, unknown>,
    schema: z.ZodType<T>,
    signal?: AbortSignal
  ): Promise<T> {
    if (
      method === 'sendMessage' ||
      method === 'createForumTopic' ||
      method === 'editForumTopic' ||
      method === 'editMessageText'
    ) {
      await this.waitForSendSlot(signal)
    }
    const response = await this.fetcher(`${API}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.any([AbortSignal.timeout(40_000), ...(signal ? [signal] : [])])
    }).catch(() => {
      throw new Error('Нет связи с Telegram.')
    })
    const envelope = z
      .object({
        ok: z.boolean(),
        result: z.unknown().optional(),
        error_code: z.number().optional(),
        description: z.string().optional(),
        parameters: z.object({ retry_after: z.number().positive().optional() }).optional()
      })
      .parse(await response.json().catch(() => null))
    if (!response.ok || !envelope.ok) {
      if (envelope.error_code === 429) {
        this.nextSendAt = Math.max(
          this.nextSendAt,
          Date.now() + (envelope.parameters?.retry_after ?? 1) * 1000
        )
      }
      throw new TelegramApiError(
        envelope.error_code ?? response.status,
        envelope.parameters?.retry_after,
        /message thread not found|message_thread_not_found/i.test(envelope.description ?? ''),
        /message to edit not found|message_id_invalid/i.test(envelope.description ?? ''),
        /message is not modified/i.test(envelope.description ?? '')
      )
    }
    return schema.parse(envelope.result)
  }

  me(signal?: AbortSignal) {
    return this.call('getMe', {}, TelegramBot, signal)
  }
  updates(offset: number, signal: AbortSignal) {
    return this.call(
      'getUpdates',
      { offset, timeout: 20, allowed_updates: ['message', 'callback_query'] },
      z.array(TelegramUpdate),
      signal
    )
  }
  topic(chatId: number, name: string, signal: AbortSignal) {
    return this.call(
      'createForumTopic',
      { chat_id: chatId, name: name.slice(0, 128) },
      z.object({ message_thread_id: z.number().int().positive() }),
      signal
    )
  }
  renameTopic(chatId: number, threadId: number, name: string, signal: AbortSignal) {
    return this.call(
      'editForumTopic',
      { chat_id: chatId, message_thread_id: threadId, name },
      z.boolean(),
      signal
    )
  }
  async text(
    chatId: number,
    threadId: number | undefined,
    text: string,
    keyboard?: TelegramReplyMarkup,
    signal?: AbortSignal,
    options?: { silent?: boolean }
  ): Promise<number> {
    const parts = splitTelegramText(text)
    let id = 0
    for (let index = 0; index < parts.length; index++) {
      const result = await this.call(
        'sendMessage',
        {
          chat_id: chatId,
          message_thread_id: threadId,
          text: parts[index],
          ...(options?.silent ? { disable_notification: true } : {}),
          ...(index === parts.length - 1 && keyboard ? { reply_markup: keyboard } : {}),
          link_preview_options: { is_disabled: true }
        },
        MessageResult,
        signal
      )
      id = result.message_id
    }
    return id
  }
  answerCallback(id: string, signal: AbortSignal) {
    return this.call('answerCallbackQuery', { callback_query_id: id }, z.boolean(), signal)
  }
  async editText(
    chatId: number,
    messageId: number,
    text: string,
    keyboard: TelegramKeyboard | undefined,
    signal: AbortSignal
  ): Promise<void> {
    await this.call(
      'editMessageText',
      { chat_id: chatId, message_id: messageId, text, reply_markup: keyboard },
      z.union([MessageResult, z.boolean()]),
      signal
    )
  }
  async download(fileId: string, signal: AbortSignal): Promise<Buffer> {
    const file = await this.call(
      'getFile',
      { file_id: fileId },
      z.object({ file_path: z.string(), file_size: z.number().optional() }),
      signal
    )
    if (
      (file.file_size ?? 0) > TELEGRAM_MAX_DOWNLOAD_BYTES ||
      !/^[A-Za-z0-9_./-]+$/.test(file.file_path) ||
      file.file_path.split('/').includes('..')
    ) {
      throw new Error('Файл недоступен или превышает 20 МБ.')
    }
    const response = await this.fetcher(`${API}/file/bot${this.token}/${file.file_path}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
      redirect: 'error'
    }).catch(() => {
      throw new Error('Не удалось скачать файл из Telegram.')
    })
    if (!response.ok || !response.body) {
      throw new Error('Не удалось скачать файл из Telegram.')
    }
    const chunks: Uint8Array[] = []
    let length = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) {
          break
        }
        length += chunk.value.byteLength
        if (length > TELEGRAM_MAX_DOWNLOAD_BYTES) {
          throw new Error('Файл превышает 20 МБ.')
        }
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    return Buffer.concat(chunks)
  }
  async document(
    chatId: number,
    threadId: number,
    bytes: Uint8Array,
    name: string,
    signal: AbortSignal
  ): Promise<void> {
    await this.waitForSendSlot(signal)
    const form = new FormData()
    form.set('chat_id', String(chatId))
    form.set('message_thread_id', String(threadId))
    form.set('document', new Blob([new Uint8Array(bytes)]), name)
    const response = await this.fetcher(`${API}/bot${this.token}/sendDocument`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)])
    }).catch(() => {
      throw new Error('Не удалось отправить файл в Telegram.')
    })
    const result = z
      .object({
        ok: z.boolean(),
        error_code: z.number().optional(),
        description: z.string().optional()
      })
      .parse(await response.json())
    if (!response.ok || !result.ok) {
      throw new TelegramApiError(
        result.error_code ?? response.status,
        1,
        /message thread not found|message_thread_not_found/i.test(result.description ?? '')
      )
    }
  }

  private async waitForSendSlot(signal?: AbortSignal): Promise<void> {
    const now = Date.now()
    const slot = Math.max(now, this.nextSendAt)
    this.nextSendAt = slot + this.sendIntervalMs
    if (slot > now) {
      await delay(slot - now, undefined, { signal })
    }
    signal?.throwIfAborted()
  }
}

export function splitTelegramText(text: string): string[] {
  const parts: string[] = []
  let part = ''
  for (const point of text || 'Пустой ответ.') {
    if (part.length + point.length > 3500) {
      parts.push(part)
      part = ''
    }
    part += point
  }
  if (part) {
    parts.push(part)
  }
  return parts
}
