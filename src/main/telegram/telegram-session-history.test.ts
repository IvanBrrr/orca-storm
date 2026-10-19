import { expect, it, vi } from 'vitest'
import { deliverTelegramSessionHistory } from './telegram-session-history'
import { syncTelegramSessions } from './telegram-session-sync'
import { telegramTestFixture, telegramTestItem } from './telegram-test-fixture'

it('backfills existing topics with the latest ten user/assistant messages quietly and only once', async () => {
  const h = await telegramTestFixture()
  const topic = await h.ctx.topic(h.sessions[0]!)
  const items = Array.from({ length: 15 }, (_, i) =>
    telegramTestItem(
      {
        kind: 'message',
        role: i % 2 ? 'assistant' : 'user',
        blocks: [{ type: 'text', text: `Message ${i}` }]
      },
      `message-${i}`
    )
  )
  items.push(
    telegramTestItem({
      kind: 'message',
      role: 'assistant',
      state: 'running',
      blocks: [{ type: 'text', text: 'streaming' }]
    })
  )
  items.push({ ...items[0]!, agentId: 'child' })
  h.setItems(items)
  await syncTelegramSessions(h.ctx)
  await syncTelegramSessions(h.ctx)
  const preview = h.sent.filter((entry) => String(entry.params.text).startsWith('Из истории'))
  expect(preview).toHaveLength(10)
  expect(preview[0]?.params.text).toBe('Из истории · Агент\n\nMessage 5')
  expect(preview.at(-1)?.params.text).toBe('Из истории · Ты\n\nMessage 14')
  expect(preview.every((entry) => entry.params.disable_notification === true)).toBe(true)
  expect(topic.historyDelivered).toBe(true)
  await h.state.load()
  await deliverTelegramSessionHistory(h.ctx, h.sessions[0]!, h.state.data.topics['session-1']!)
  expect(h.sent.filter((entry) => String(entry.params.text).startsWith('Из истории'))).toHaveLength(
    10
  )
})

it('retries an interrupted backfill without repeating delivered messages or blocking live replies', async () => {
  const h = await telegramTestFixture()
  const topic = await h.ctx.topic(h.sessions[0]!)
  h.setItems(
    ['First', 'Second'].map((text, i) =>
      telegramTestItem(
        {
          kind: 'message',
          role: 'assistant',
          blocks: [{ type: 'text', text }]
        },
        `item-${i}`
      )
    )
  )
  const send = vi.spyOn(h.ctx, 'text')
  send.mockResolvedValueOnce(1001).mockRejectedValueOnce(new Error('offline'))
  await expect(deliverTelegramSessionHistory(h.ctx, h.sessions[0]!, topic)).rejects.toThrow(
    'offline'
  )
  send.mockRestore()
  await deliverTelegramSessionHistory(h.ctx, h.sessions[0]!, topic)
  expect(h.sent.filter((entry) => String(entry.params.text).includes('Second'))).toHaveLength(1)
  expect(topic.historyDelivered).toBe(true)
  expect(topic.seen).toContain('history:item-0')
  expect(topic.seen).toContain('message:item-1')
})

it('keeps an unavailable history retryable and bounds oversized previews', async () => {
  const h = await telegramTestFixture()
  const topic = await h.ctx.topic(h.sessions[0]!)
  h.port.recentHistory = async () => null
  await deliverTelegramSessionHistory(h.ctx, h.sessions[0]!, topic)
  expect(topic.historyDelivered).not.toBe(true)
  h.port.recentHistory = async () => [
    telegramTestItem({
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: '😀'.repeat(20_000) }]
    })
  ]
  await deliverTelegramSessionHistory(h.ctx, h.sessions[0]!, topic)
  const texts = h.sent.filter((entry) => String(entry.params.text).includes('😀'))
  expect(texts.every((entry) => String(entry.params.text).length <= 3500)).toBe(true)
  expect(texts.map((entry) => entry.params.text).join('')).toContain(
    'Полный текст доступен в Storca.'
  )
})
