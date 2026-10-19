import { expect, it, vi } from 'vitest'
import {
  TelegramApiError,
  TelegramBotClient,
  TELEGRAM_MAX_DOWNLOAD_BYTES,
  splitTelegramText
} from './telegram-bot-client'

it('does not expose a token when a network implementation throws its request URL', async () => {
  const token = '12345:private-token'
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    throw new Error(String(url))
  })
  const client = new TelegramBotClient(token, fetcher, 0)
  await expect(client.me()).rejects.toThrow('Нет связи с Telegram.')
  try {
    await client.me()
  } catch (error) {
    expect(String(error)).not.toContain(token)
  }
})

it('preserves retry_after and never surfaces an untrusted Telegram error description', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json(
      {
        ok: false,
        error_code: 429,
        description: 'secret token echo',
        parameters: { retry_after: 17 }
      },
      { status: 429 }
    )
  )
  const client = new TelegramBotClient('token', fetcher, 0)
  await expect(client.me()).rejects.toMatchObject({ code: 429, retryAfter: 17 })
  await expect(client.me()).rejects.toBeInstanceOf(TelegramApiError)
  await expect(client.me()).rejects.not.toThrow('secret token echo')
})

it('rejects file path traversal before requesting bytes', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ ok: true, result: { file_path: '../secret' } })
  )
  const client = new TelegramBotClient('token', fetcher, 0)
  await expect(client.download('file', new AbortController().signal)).rejects.toThrow('недоступен')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('enforces the download bound even when file metadata omits its length', async () => {
  let calls = 0
  const fetcher = vi.fn<typeof fetch>(async () => {
    calls++
    if (calls === 1) {
      return Response.json({ ok: true, result: { file_path: 'documents/file.bin' } })
    }
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(TELEGRAM_MAX_DOWNLOAD_BYTES))
          controller.enqueue(new Uint8Array(1))
          controller.close()
        }
      })
    )
  })
  const client = new TelegramBotClient('token', fetcher, 0)
  await expect(client.download('file', new AbortController().signal)).rejects.toThrow('20 МБ')
})

it('splits long Unicode replies without breaking surrogate pairs or exceeding Telegram limits', () => {
  const text = '😀'.repeat(7000)
  const parts = splitTelegramText(text)
  expect(parts.join('')).toBe(text)
  expect(parts.every((part) => part.length <= 3500 && !part.includes('\uFFFD'))).toBe(true)
})

it('sends every part of a silent receipt quietly while leaving ordinary replies unchanged', async () => {
  const params: Record<string, unknown>[] = []
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    params.push(JSON.parse(String(init?.body)))
    return Response.json({ ok: true, result: { message_id: 1 } })
  })
  const client = new TelegramBotClient('token', fetcher, 0)
  await client.text(42, 101, 'Receipt '.repeat(1000), undefined, undefined, { silent: true })
  expect(params.length).toBeGreaterThan(1)
  expect(params.every((part) => part.disable_notification === true)).toBe(true)
  await client.text(42, 101, 'Answer')
  expect(params.at(-1)?.disable_notification).toBeUndefined()
})
