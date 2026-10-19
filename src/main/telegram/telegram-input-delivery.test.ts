import { expect, it } from 'vitest'
import { routeTelegramUpdate } from './telegram-update-router'
import { TelegramInputNotDeliveredError } from './telegram-input-refusal'
import { syncTelegramSessions } from './telegram-session-sync'
import {
  telegramTestCallback,
  telegramTestFixture,
  telegramTestMessage
} from './telegram-test-fixture'

it('retries confirmed zero-byte refusals with a new operation and never repeats a completed button', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  h.send.mockRejectedValueOnce(new TelegramInputNotDeliveredError('Ввод не передан.'))
  const update = { update_id: 1, message: telegramTestMessage() }
  await routeTelegramUpdate(h.ctx, update)
  expect(h.sent.at(-1)?.params.text).toContain('Задача сохранена')
  const retry = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'draft' && !s.used
  )!
  await h.state.load()
  await routeTelegramUpdate(h.ctx, telegramTestCallback(retry[0], 101))
  await routeTelegramUpdate(h.ctx, telegramTestCallback(retry[0], 101))
  await routeTelegramUpdate(h.ctx, update)
  expect(h.send).toHaveBeenCalledTimes(2)
  expect(h.send.mock.calls[0]?.[1]).not.toBe(h.send.mock.calls[1]?.[1])
  expect(h.send.mock.calls[0]?.[2]).toEqual(h.send.mock.calls[1]?.[2])
})

it('checks ambiguous delivery using the same durable operation instead of sending a second task', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  h.send.mockRejectedValueOnce(new Error('Связь прервалась.'))
  await routeTelegramUpdate(h.ctx, { update_id: 2, message: telegramTestMessage() })
  const retry = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'draft' && !s.used
  )!
  await h.state.load()
  await routeTelegramUpdate(h.ctx, telegramTestCallback(retry[0], 101))
  expect(h.send).toHaveBeenCalledTimes(2)
  expect(h.send.mock.calls[0]?.[1]).toBe(h.send.mock.calls[1]?.[1])
})

it('explains a pending permission and lets the owner cancel the saved retry without writing', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  h.send.mockRejectedValueOnce(new Error('terminal_guard_permission'))
  await routeTelegramUpdate(h.ctx, { update_id: 3, message: telegramTestMessage() })
  expect(h.sent.at(-1)?.params.text).toContain('Codex ждёт разрешения')
  const cancel = Object.entries(h.state.data.actions).find(([, s]) => s.action.kind === 'discard')!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(cancel[0], 101))
  const retry = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'draft' && s.action.confirmation === undefined
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(retry[0], 101))
  expect(h.send).toHaveBeenCalledTimes(1)
})

it('shows the terminal immediately before a queued turn starts and adopts that turn in the same quiet message', async () => {
  const h = await telegramTestFixture()
  const session = h.sessions[0]!
  session.turnStartedAt = 1
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'idle',
    latestPrompt: 'Old task',
    updatedAt: 1
  }
  await h.ctx.topic(session)
  let key = 'old-turn'
  h.port.progress = async () => ({ key, start: 'Old task', lines: ['Already visible in terminal'] })
  h.send.mockResolvedValue(true)
  await routeTelegramUpdate(h.ctx, {
    update_id: 4,
    message: telegramTestMessage({ text: 'New task' })
  })
  const topic = h.state.data.topics[session.id]!
  const messageId = topic.progress!.messageId
  expect(topic.progress?.text).toContain('Already visible in terminal')
  expect(topic.progress?.text).toContain('New task')
  expect(topic.progress?.pendingStart).toBe(true)
  await syncTelegramSessions(h.ctx)
  expect(h.ctx.requested.has(session.id)).toBe(true)
  key = 'new-turn'
  session.turnStartedAt = 2
  session.status.status = 'working'
  topic.progress!.updatedAt = 0
  await syncTelegramSessions(h.ctx)
  expect(topic.progress?.messageId).toBe(messageId)
  expect(topic.progress?.pendingStart).toBe(false)
  expect(topic.progress?.text).toContain('New task')
  expect(
    h.sent.filter(
      (s) => s.method === 'sendMessage' && String(s.params.text).startsWith('Ход работы')
    )
  ).toHaveLength(1)
  expect(
    h.sent
      .filter((s) => String(s.params.text).startsWith('Ход работы'))
      .every((s) => s.method === 'editMessageText' || s.params.disable_notification === true)
  ).toBe(true)
})
