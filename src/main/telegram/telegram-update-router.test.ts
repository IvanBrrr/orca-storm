import { expect, it } from 'vitest'
import { parseAgentSessionOperationTimestamp } from '../../shared/agent-session-host-authority'
import { routeTelegramUpdate } from './telegram-update-router'
import {
  telegramTestCallback,
  telegramTestFixture,
  telegramTestMessage
} from './telegram-test-fixture'

it('rejects strangers, groups, forwarded callback identities, and unbound topics', async () => {
  const h = await telegramTestFixture()
  await routeTelegramUpdate(h.ctx, {
    update_id: 1,
    message: telegramTestMessage({ from: { id: 99, is_bot: false } })
  })
  await routeTelegramUpdate(h.ctx, {
    update_id: 2,
    message: telegramTestMessage({ chat: { id: 42, type: 'supergroup' } })
  })
  const key = h.state.action({ kind: 'stop', sessionId: 'session-1' }, 101)
  const callback = telegramTestCallback(key, 101)
  if (callback.callback_query) {
    callback.callback_query.from.id = 99
  }
  await routeTelegramUpdate(h.ctx, callback)
  expect(h.sent).toHaveLength(0)
  await routeTelegramUpdate(h.ctx, {
    update_id: 3,
    message: telegramTestMessage({ message_thread_id: 999 })
  })
  expect(h.send).not.toHaveBeenCalled()
  expect(h.stop).not.toHaveBeenCalled()
})

it('requires a live single-use pairing nonce and clears old chat bindings on account change', async () => {
  const h = await telegramTestFixture()
  const nonce = h.state.beginPairing()
  h.state.data.topics['session-1'] = {
    threadId: 101,
    name: 'Old',
    closed: false,
    seen: [],
    lastUpdated: 1
  }
  const message = telegramTestMessage({
    chat: { id: 99, type: 'private' },
    from: { id: 99, is_bot: false },
    text: `/start ${nonce}`,
    message_thread_id: undefined
  })
  await routeTelegramUpdate(h.ctx, {
    update_id: 1,
    message: { ...message, text: `/start ${'a'.repeat(32)}` }
  })
  expect(h.state.data.ownerId).toBe(42)
  await routeTelegramUpdate(h.ctx, { update_id: 2, message })
  expect(h.state.data.ownerId).toBe(99)
  expect(h.state.data.pairing).toBeNull()
  expect(h.state.data.topics).toEqual({})
  await routeTelegramUpdate(h.ctx, {
    update_id: 3,
    message: { ...message, chat: { id: 42, type: 'private' }, from: { id: 42, is_bot: false } }
  })
  expect(h.state.data.ownerId).toBe(99)
})

it('routes replies to the topic session and gives retransmissions the same durable operation ID', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  h.send.mockResolvedValue(true)
  const update = { update_id: 12, message: telegramTestMessage() }
  await routeTelegramUpdate(h.ctx, update)
  await routeTelegramUpdate(h.ctx, update)
  expect(h.send.mock.calls[0]?.[1]).toBe(h.send.mock.calls[1]?.[1])
  expect(parseAgentSessionOperationTimestamp(h.send.mock.calls[0]?.[1] ?? '')).not.toBeNull()
  expect(h.send).toHaveBeenCalledWith('session-1', expect.any(String), {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Task' }]
  })
  expect(h.sent.some((entry) => entry.params.text === 'Сообщение в очереди.')).toBe(true)
})

it('holds offline messages for confirmation and refuses cross-topic or repeated buttons', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  await routeTelegramUpdate(h.ctx, {
    update_id: 10,
    message: telegramTestMessage({ date: Math.floor(Date.now() / 1000) - 3600 })
  })
  expect(h.send).not.toHaveBeenCalled()
  const draft = Object.entries(h.state.data.actions).find(
    ([, stored]) => stored.action.kind === 'draft'
  )
  expect(draft).toBeDefined()
  if (!draft) {
    throw new Error('draft missing')
  }
  await routeTelegramUpdate(h.ctx, telegramTestCallback(draft[0], 999))
  expect(h.send).not.toHaveBeenCalled()
  await routeTelegramUpdate(h.ctx, telegramTestCallback(draft[0], 101))
  await routeTelegramUpdate(h.ctx, telegramTestCallback(draft[0], 101))
  expect(h.send).toHaveBeenCalledTimes(1)
})

it('creates a session in a listed folder and materializes its topic once', async () => {
  const h = await telegramTestFixture()
  const key = h.state.action({ kind: 'create', workspace: 'workspace-1' })
  await routeTelegramUpdate(h.ctx, telegramTestCallback(key))
  await routeTelegramUpdate(h.ctx, telegramTestCallback(key))
  expect(h.create).toHaveBeenCalledExactlyOnceWith('workspace-1', expect.any(String))
  expect(h.state.data.topics['session-2']).toBeDefined()
})

it('does not send or start work in a closed session', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  h.sessions[0]!.visible = false
  await expect(
    routeTelegramUpdate(h.ctx, { update_id: 12, message: telegramTestMessage() })
  ).rejects.toThrow('закрыта')
  expect(h.send).not.toHaveBeenCalled()
})
