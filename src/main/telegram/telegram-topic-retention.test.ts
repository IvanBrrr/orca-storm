import { expect, it, vi } from 'vitest'
import { TelegramApiError } from './telegram-bot-client'
import { TelegramSessionContext } from './telegram-session-context'
import { syncTelegramSessions } from './telegram-session-sync'
import { routeTelegramSessionNavigation } from './telegram-session-navigation'
import { routeTelegramUpdate } from './telegram-update-router'
import {
  telegramTestCallback,
  telegramTestFixture,
  telegramTestItem,
  telegramTestMessage
} from './telegram-test-fixture'

async function existingTopics() {
  const h = await telegramTestFixture()
  const base = h.sessions[0]!
  h.sessions.splice(
    0,
    1,
    ...Array.from({ length: 11 }, (_, index) => ({
      ...base,
      id: `session-${index}`,
      name: `Task ${index}`,
      updatedAt: index
    }))
  )
  for (const [index, session] of h.sessions.entries()) {
    h.state.data.topics[session.id] = {
      threadId: 1000 + index,
      name: session.name,
      closed: false,
      seen: [],
      historyDelivered: true,
      lastUpdated: session.updatedAt
    }
  }
  await h.ctx.refresh()
  await h.state.save()
  return h
}

it('retries deletion after restart and treats only a confirmed missing topic as already removed', async () => {
  const h = await existingTopics()
  const key = h.state.action({ kind: 'status', sessionId: 'session-0' }, 1000)
  vi.spyOn(h.ctx.client, 'deleteTopic')
    .mockRejectedValueOnce(new TelegramApiError(429, 17))
    .mockRejectedValueOnce(new TelegramApiError(400, 1, true))
  await expect(syncTelegramSessions(h.ctx)).rejects.toMatchObject({ code: 429, retryAfter: 17 })
  await h.state.load()
  expect(h.state.data.topics['session-0']?.deleting).toBe(true)
  expect(h.state.data.actions[key]?.used).toBe(false)
  const restarted = new TelegramSessionContext(
    h.ctx.client,
    h.state,
    h.port,
    h.ctx.signal,
    () => false
  )
  await syncTelegramSessions(restarted)
  expect(h.state.data.topics['session-0']).toBeUndefined()
  expect(h.state.data.retiredThreads['1000']?.sessionId).toBe('session-0')
  expect(h.state.data.actions[key]?.used).toBe(true)
  expect(h.sent.some((entry) => entry.method === 'createForumTopic')).toBe(false)
})

it('keeps the binding on a permission failure and never creates an eleventh topic', async () => {
  const h = await existingTopics()
  vi.spyOn(h.ctx.client, 'deleteTopic').mockRejectedValue(new TelegramApiError(403))
  await expect(syncTelegramSessions(h.ctx)).rejects.toMatchObject({ code: 403 })
  h.sessions.push({ ...h.sessions[0]!, id: 'new', updatedAt: 100 })
  await h.ctx.refresh()
  await expect(h.ctx.topic(h.sessions.at(-1)!)).rejects.toMatchObject({ code: 403 })
  expect(Object.keys(h.state.data.topics)).toHaveLength(11)
  expect(h.sent.some((entry) => entry.method === 'createForumTopic')).toBe(false)
  expect(h.state.data.topics['session-0']?.threadId).toBe(1000)
})

it('finishes a persisted deletion before recreating a session that became recent again', async () => {
  const h = await existingTopics()
  const save = h.state.save.bind(h.state)
  vi.spyOn(h.state, 'save').mockImplementation(async () => {
    if (!h.state.data.topics['session-0']) {
      throw new Error('disk unavailable after deletion')
    }
    await save()
  })
  await expect(syncTelegramSessions(h.ctx)).rejects.toThrow('disk unavailable')
  vi.mocked(h.state.save).mockRestore()
  await h.state.load()
  h.sessions[0]!.updatedAt = 100
  vi.spyOn(h.ctx.client, 'deleteTopic').mockRejectedValueOnce(new TelegramApiError(400, 1, true))
  await syncTelegramSessions(h.ctx)
  expect(h.state.data.topics['session-0']?.threadId).not.toBe(1000)
  expect(h.state.data.topics['session-0']?.deleting).toBeUndefined()
  expect(Object.keys(h.state.data.topics)).toHaveLength(10)
})

it('reserves space before concurrent explicit opens and keeps the selected older sessions after restart', async () => {
  const h = await existingTopics()
  await syncTelegramSessions(h.ctx)
  h.sessions.push({ ...h.sessions[0]!, id: 'older', updatedAt: -1 })
  await h.ctx.refresh()
  const live = new Set(Object.values(h.state.data.topics).map((topic) => topic.threadId))
  const create = h.ctx.client.topic.bind(h.ctx.client)
  const remove = h.ctx.client.deleteTopic.bind(h.ctx.client)
  vi.spyOn(h.ctx.client, 'topic').mockImplementation(async (...args) => {
    expect(live.size).toBeLessThan(10)
    const result = await create(...args)
    live.add(result.message_thread_id)
    return result
  })
  vi.spyOn(h.ctx.client, 'deleteTopic').mockImplementation(async (...args) => {
    const result = await remove(...args)
    live.delete(args[1])
    return result
  })
  await Promise.all([h.ctx.topic(h.sessions[0]!), h.ctx.topic(h.sessions.at(-1)!)])
  await h.state.load()
  await syncTelegramSessions(h.ctx)
  expect(live.size).toBe(10)
  expect(Object.keys(h.state.data.topics)).toHaveLength(10)
  expect(h.state.data.topics['session-0']).toBeDefined()
  expect(h.state.data.topics.older).toBeDefined()
})

it('acknowledges a selection in the root chat when its source topic was evicted', async () => {
  const h = await existingTopics()
  await syncTelegramSessions(h.ctx)
  await routeTelegramSessionNavigation(
    h.ctx,
    { kind: 'session-open', sessionId: 'session-0' },
    1001,
    17
  )
  expect(h.state.data.topics['session-1']).toBeUndefined()
  expect(h.sent.at(-1)?.params.message_thread_id).toBeUndefined()
  expect(h.sent.at(-1)?.params).toMatchObject({
    text: expect.stringContaining('Продолжение в теме')
  })
  const button = Object.values(h.state.data.actions).find(
    (stored) => stored.action.kind === 'sessions' && stored.threadId === undefined
  )
  expect(button).toBeDefined()
})

it('pins late messages from evicted topics to their original session and requires an explicit reopen', async () => {
  const h = await existingTopics()
  await syncTelegramSessions(h.ctx)
  await routeTelegramUpdate(h.ctx, {
    update_id: 90,
    message: telegramTestMessage({ message_thread_id: 1000, text: 'Continue original task' })
  })
  expect(h.send).not.toHaveBeenCalled()
  expect(h.sent.at(-1)?.params.message_thread_id).toBeUndefined()
  expect(h.sent.at(-1)?.params).toMatchObject({
    text: expect.stringContaining('Сообщение сохранено для этой сессии')
  })
  const open = Object.entries(h.state.data.actions).find(
    ([, stored]) => stored.action.kind === 'session-open' && stored.action.sessionId === 'session-0'
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(open[0]))
  expect(h.send).toHaveBeenCalledExactlyOnceWith('session-0', expect.any(String), {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Continue original task' }]
  })
  expect(Object.keys(h.state.data.topics)).toHaveLength(10)
})

it('does not evict an unanswered Telegram task to open another session', async () => {
  const h = await existingTopics()
  await syncTelegramSessions(h.ctx)
  for (const session of h.sessions.slice(1)) {
    h.ctx.request(session.id, true)
  }
  const before = h.sent.length
  await expect(h.ctx.topic(h.sessions[0]!)).rejects.toThrow('Все десять тем ждут ответа')
  expect(h.sent.slice(before)).toEqual([])
  expect(h.state.data.replySessions).toHaveLength(10)
  expect(Object.keys(h.state.data.topics)).toHaveLength(10)
})

it('keeps the ten most recent known topics while the session inventory is unavailable', async () => {
  const h = await existingTopics()
  const saved = [...h.sessions]
  h.sessions.length = 0
  await syncTelegramSessions(h.ctx)
  expect(Object.keys(h.state.data.topics)).toHaveLength(10)
  expect(h.state.data.topics['session-0']).toBeUndefined()
  expect(h.sent.filter((entry) => entry.method === 'deleteForumTopic')).toHaveLength(1)
  await h.state.load()
  await syncTelegramSessions(h.ctx)
  expect(Object.keys(h.state.data.topics)).toHaveLength(10)
  h.sessions.push(...saved)
  await syncTelegramSessions(h.ctx)
  expect(h.sent.some((entry) => entry.method === 'createForumTopic')).toBe(false)
})

it('delivers an awaited answer despite an unrelated deletion failure and does not create more topics', async () => {
  const h = await existingTopics()
  const session = h.sessions[10]!
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'idle',
    latestPrompt: '',
    updatedAt: session.updatedAt
  }
  h.ctx.request(session.id, true)
  h.sessions.push({ ...session, id: 'new', updatedAt: 100 })
  h.port.history = async (id) =>
    id === session.id
      ? [
          telegramTestItem({
            kind: 'message',
            role: 'assistant',
            blocks: [{ type: 'text', text: 'Awaited answer' }]
          })
        ]
      : []
  vi.spyOn(h.ctx.client, 'deleteTopic').mockRejectedValue(new TelegramApiError(403))
  await expect(syncTelegramSessions(h.ctx)).rejects.toMatchObject({ code: 403 })
  expect(h.sent.find((entry) => entry.params.text === 'Awaited answer')?.params).toMatchObject({
    message_thread_id: 1010,
    disable_notification: false
  })
  expect(h.ctx.requested.has(session.id)).toBe(false)
  expect(h.sent.some((entry) => entry.method === 'createForumTopic')).toBe(false)
})
