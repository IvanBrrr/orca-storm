import { expect, it, vi } from 'vitest'
import { syncTelegramSessions } from './telegram-session-sync'
import { routeTelegramSessionNavigation } from './telegram-session-navigation'
import { routeTelegramUpdate } from './telegram-update-router'
import { telegramTestFixture, telegramTestItem, telegramTestMessage } from './telegram-test-fixture'

async function manySessions() {
  const h = await telegramTestFixture()
  const base = h.sessions[0]!
  h.sessions.splice(
    0,
    1,
    ...Array.from({ length: 50 }, (_, index) => ({
      ...base,
      id: `session-${index}`,
      source: index % 2 ? ('terminal' as const) : undefined,
      workspaceId: `workspace-${index}`,
      name: `Task ${index}`,
      updatedAt: index
    })),
    { ...base, id: 'closed', visible: false, updatedAt: 100 }
  )
  return h
}

it('automatically creates only the ten most recent topics across workspaces and session sources', async () => {
  const h = await manySessions()
  const history = vi.spyOn(h.port, 'history')
  await syncTelegramSessions(h.ctx)
  await h.state.load()
  await syncTelegramSessions(h.ctx)
  const expected = Array.from({ length: 10 }, (_, index) => `session-${40 + index}`)
  expect(Object.keys(h.state.data.topics).sort()).toEqual(expected)
  expect(h.sent.filter((entry) => entry.method === 'createForumTopic')).toHaveLength(10)
  expect(new Set(history.mock.calls.map(([id]) => id))).toEqual(new Set(expected))

  h.sessions[0]!.updatedAt = 101
  await syncTelegramSessions(h.ctx)
  expect(h.sent.filter((entry) => entry.method === 'createForumTopic')).toHaveLength(11)
  const nextHistory = history.mock.calls.length
  await syncTelegramSessions(h.ctx)
  expect(history.mock.calls.slice(nextHistory).some(([id]) => id === 'session-40')).toBe(false)
  expect(h.state.data.topics['session-40']).toBeUndefined()
  expect(Object.keys(h.state.data.topics)).toHaveLength(10)
})

it('deletes older topics without reading their histories and keeps a requested reply until delivery', async () => {
  const h = await manySessions()
  for (const [index, session] of h.sessions.entries()) {
    session.status = {
      sessionId: session.id,
      workspaceId: session.workspaceId,
      agent: session.agent,
      status: 'working',
      latestPrompt: '',
      updatedAt: session.updatedAt
    }
    h.state.data.topics[session.id] = {
      threadId: 1000 + index,
      name: session.name,
      closed: !session.visible,
      seen: [],
      lastUpdated: session.updatedAt
    }
  }
  await h.state.save()
  await h.state.load()
  h.ctx.request('session-0', true)
  const history = vi.spyOn(h.port, 'history')
  const progress = vi.fn(async (_id: string) => ({ key: 'turn', start: '', lines: [] }))
  h.port.progress = progress
  h.setAway(true)
  await syncTelegramSessions(h.ctx)
  expect(
    history.mock.calls.every(([id]) => id === 'session-0' || Number(id.split('-')[1]) >= 41)
  ).toBe(true)
  expect(progress.mock.calls).toHaveLength(10)
  expect(
    progress.mock.calls.every(([id]) => id === 'session-0' || Number(id.split('-')[1]) >= 41)
  ).toBe(true)
  expect(h.sent.filter((entry) => entry.method === 'deleteForumTopic')).toHaveLength(41)
  expect(Object.keys(h.state.data.topics)).toHaveLength(10)
  expect(h.ctx.sessionForThread(1000)?.id).toBe('session-0')

  const session = h.sessions[0]!
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: session.agent,
    status: 'idle',
    latestPrompt: '',
    updatedAt: 1
  }
  h.ctx.request(session.id, true)
  h.sent.length = 0
  h.setItems([
    telegramTestItem({
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Requested result from an older session' }]
    })
  ])
  await syncTelegramSessions(h.ctx)
  expect(h.sent.filter((entry) => entry.params.message_thread_id === 1000)).toEqual([
    expect.objectContaining({
      method: 'sendMessage',
      params: expect.objectContaining({
        text: 'Requested result from an older session',
        disable_notification: false
      })
    })
  ])
  expect(h.ctx.requested.has(session.id)).toBe(false)
  await syncTelegramSessions(h.ctx)
  expect(h.state.data.topics[session.id]).toBeDefined()
  expect(h.sent.some((entry) => entry.method === 'createForumTopic')).toBe(false)
})

it('keeps all older sessions in the paginated catalog and creates their topics only when explicitly opened', async () => {
  const h = await manySessions()
  await syncTelegramSessions(h.ctx)
  await routeTelegramSessionNavigation(h.ctx, { kind: 'sessions', page: 4 })
  expect(h.sent.at(-1)?.params.text).toContain('Сессий Storca: 50.')
  expect(h.sent.at(-1)?.params.text).toContain('Страница 5 из 5')
  expect(
    Object.values(h.state.data.actions).some(
      (stored) => stored.action.kind === 'session-select' && stored.action.sessionId === 'session-0'
    )
  ).toBe(true)
  expect(h.sent.filter((entry) => entry.method === 'createForumTopic')).toHaveLength(10)
  h.setItems([
    telegramTestItem({
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Older conversation context' }]
    })
  ])
  await routeTelegramSessionNavigation(h.ctx, { kind: 'session-open', sessionId: 'session-0' })
  const topic = h.state.data.topics['session-0']!
  expect(h.sent.filter((entry) => entry.method === 'createForumTopic')).toHaveLength(11)
  expect(
    h.sent.some(
      (entry) =>
        entry.params.message_thread_id === topic.threadId &&
        entry.params.text === 'Из истории · Агент\n\nOlder conversation context' &&
        entry.params.disable_notification === true
    )
  ).toBe(true)
  await routeTelegramUpdate(h.ctx, {
    update_id: 90,
    message: telegramTestMessage({ message_thread_id: topic.threadId, text: 'Continue the task' })
  })
  expect(h.send).toHaveBeenCalledExactlyOnceWith('session-0', expect.any(String), {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Continue the task' }]
  })
  expect(h.ctx.requested.has('session-0')).toBe(true)
})
