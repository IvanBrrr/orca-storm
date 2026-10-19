import { expect, it, vi } from 'vitest'
import { TelegramIntegrationService } from './telegram-integration-service'
import { TelegramBotClient } from './telegram-bot-client'
import { telegramTestFixture, telegramTestMessage } from './telegram-test-fixture'

it('acknowledges an update only after handling it and never returns credentials to settings', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  let offered = false
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (!String(input).endsWith('/getUpdates')) {
      return h.fetcher(input, init)
    }
    if (!offered) {
      offered = true
      return Response.json({
        ok: true,
        result: [{ update_id: 12, message: telegramTestMessage() }]
      })
    }
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (signal?.aborted) {
        reject(new Error('aborted'))
        return
      }
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  })
  const service = new TelegramIntegrationService(
    h.state,
    h.port,
    () => false,
    (token) => new TelegramBotClient(token, fetcher, 0)
  )
  try {
    await service.configure('12345:abcdefghijklmnopqrstuvwxyz')
    await vi.waitFor(() => expect(h.state.data.offset).toBe(13))
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(service.status())).not.toContain('abcdefghijklmnopqrstuvwxyz')
    const read = fetcher.mock.calls.find((call) => String(call[0]).endsWith('/getUpdates'))
    expect(read?.[1]?.body).toContain('"offset":0')
  } finally {
    await service.close()
  }
})

it('does not acknowledge a task whose preparation could not be persisted', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  let offered = false
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (!String(input).endsWith('/getUpdates')) {
      return h.fetcher(input, init)
    }
    if (!offered) {
      offered = true
      vi.spyOn(h.state, 'save').mockRejectedValue(new Error('disk full'))
      return Response.json({
        ok: true,
        result: [{ update_id: 12, message: telegramTestMessage() }]
      })
    }
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    )
  })
  const service = new TelegramIntegrationService(
    h.state,
    h.port,
    () => false,
    (token) => new TelegramBotClient(token, fetcher, 0)
  )
  try {
    await service.configure('12345:abcdefghijklmnopqrstuvwxyz')
    await vi.waitFor(() => expect(offered).toBe(true))
    await vi.waitFor(() => expect(service.status().error).not.toBeNull())
    expect(h.send).not.toHaveBeenCalled()
    expect(h.state.data.offset).toBe(0)
  } finally {
    vi.restoreAllMocks()
    await service.close()
  }
})
