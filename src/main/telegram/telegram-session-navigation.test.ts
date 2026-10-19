import { expect, it } from 'vitest'
import { routeTelegramUpdate } from './telegram-update-router'
import {
  telegramTestCallback,
  telegramTestFixture,
  telegramTestMessage
} from './telegram-test-fixture'

it('pages every session by recent activity and edits the same menu with reusable buttons', async () => {
  const h = await telegramTestFixture()
  const base = h.sessions[0]!
  h.sessions.splice(
    0,
    1,
    ...Array.from({ length: 25 }, (_, i) => ({
      ...base,
      id: `session-${i}`,
      name: `Task ${i}`,
      updatedAt: i
    }))
  )
  await routeTelegramUpdate(h.ctx, {
    update_id: 1,
    message: telegramTestMessage({ text: '/sessions', message_thread_id: undefined })
  })
  const first = Object.values(h.state.data.actions).filter(
    (s) => s.action.kind === 'session-select'
  )
  expect(first.map((s) => s.action.kind === 'session-select' && s.action.sessionId)).toEqual(
    Array.from({ length: 10 }, (_, i) => `session-${24 - i}`)
  )
  const page = (n: number) =>
    Object.entries(h.state.data.actions).find(
      ([, s]) => s.action.kind === 'sessions' && s.action.page === n
    )![0]
  await routeTelegramUpdate(h.ctx, telegramTestCallback(page(1)))
  await routeTelegramUpdate(h.ctx, telegramTestCallback(page(2)))
  expect(h.sent.at(-1)?.params).toMatchObject({
    message_id: 10,
    text: expect.stringContaining('Страница 3 из 3')
  })
  expect(
    Object.values(h.state.data.actions).filter((s) => s.action.kind === 'session-select')
  ).toHaveLength(25)
  const count = Object.keys(h.state.data.actions).length
  for (let i = 0; i < 5; i++) {
    await routeTelegramUpdate(h.ctx, telegramTestCallback(page(1)))
    await routeTelegramUpdate(h.ctx, telegramTestCallback(page(2)))
  }
  expect(Object.keys(h.state.data.actions)).toHaveLength(count)
  expect(h.sent.filter((s) => s.method === 'sendMessage')).toHaveLength(1)
})

it('searches the whole catalog with a plain reply after restart and preserves the query on back', async () => {
  const h = await telegramTestFixture()
  h.sessions.push({
    ...h.sessions[0]!,
    id: 'old',
    workspaceName: 'Ёлка',
    name: 'Очень старая задача',
    updatedAt: 0
  })
  const search = h.state.action({ kind: 'session-search' })
  await routeTelegramUpdate(h.ctx, telegramTestCallback(search))
  await h.state.load()
  await routeTelegramUpdate(h.ctx, {
    update_id: 2,
    message: telegramTestMessage({ text: 'ЕЛКА старая', message_thread_id: undefined })
  })
  expect(h.send).not.toHaveBeenCalled()
  expect(h.sent.at(-1)?.params.text).toContain('Найдено: 1.')
  const select = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'session-select' && s.action.sessionId === 'old'
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(select[0]))
  const back = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'sessions' && s.action.query === 'ЕЛКА старая'
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(back[0]))
  expect(h.sent.at(-1)?.params.text).toContain('Поиск: ЕЛКА старая')
  await routeTelegramUpdate(h.ctx, {
    update_id: 2,
    message: telegramTestMessage({ text: 'ЕЛКА старая', message_thread_id: undefined })
  })
  expect(Object.values(h.state.data.actions).some((s) => s.action.kind === 'route-draft')).toBe(
    false
  )
})

it('keeps an unbound task through cancel and restart, then sends it only to the explicitly selected session', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  const update = {
    update_id: 30,
    message: telegramTestMessage({ text: 'Fix this bug', message_thread_id: undefined })
  }
  await routeTelegramUpdate(h.ctx, update)
  expect(h.send).not.toHaveBeenCalled()
  await routeTelegramUpdate(h.ctx, {
    update_id: 31,
    message: telegramTestMessage({ text: '/cancel', message_thread_id: undefined })
  })
  await h.state.load()
  const select = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'session-select' && !!s.action.draftKey
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(select[0]))
  expect(h.sent.at(-1)?.params.text).toContain('Fix this bug')
  const open = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'session-open' && !!s.action.draftKey
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(open[0], 999))
  expect(h.send).not.toHaveBeenCalled()
  await routeTelegramUpdate(h.ctx, telegramTestCallback(open[0]))
  await routeTelegramUpdate(h.ctx, telegramTestCallback(open[0]))
  await routeTelegramUpdate(h.ctx, update)
  expect(h.send).toHaveBeenCalledExactlyOnceWith('session-1', expect.any(String), {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Fix this bug' }]
  })
  expect(h.sent.filter((s) => s.method === 'createForumTopic')).toHaveLength(1)
})

it('carries the saved task through /new and a plain worktree name without forwarding the name as a task', async () => {
  const h = await telegramTestFixture()
  await routeTelegramUpdate(h.ctx, {
    update_id: 40,
    message: telegramTestMessage({ text: 'Original task', message_thread_id: undefined })
  })
  await routeTelegramUpdate(h.ctx, {
    update_id: 41,
    message: telegramTestMessage({ text: '/new', message_thread_id: undefined })
  })
  const start = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'new-worktree'
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(start[0]))
  const repo = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'worktree-repo'
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(repo[0]))
  await h.state.load()
  await routeTelegramUpdate(h.ctx, {
    update_id: 42,
    message: telegramTestMessage({ text: 'New workspace', message_thread_id: undefined })
  })
  await h.state.load()
  await routeTelegramUpdate(h.ctx, {
    update_id: 42,
    message: telegramTestMessage({ text: 'New workspace', message_thread_id: undefined })
  })
  expect(h.create).toHaveBeenCalledTimes(1)
  expect(h.send).toHaveBeenCalledExactlyOnceWith('session-2', expect.any(String), {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Original task' }]
  })
  expect(
    Object.values(h.state.data.actions).filter((s) => s.action.kind === 'route-draft')
  ).toHaveLength(1)
})

it('recovers an empty search and an out-of-range page, and refuses a session closed after selection', async () => {
  const h = await telegramTestFixture()
  const empty = h.state.action({ kind: 'sessions', page: 99, query: 'Missing' })
  await routeTelegramUpdate(h.ctx, telegramTestCallback(empty))
  expect(h.sent.at(-1)?.params.text).toContain('Ничего не найдено')
  expect(h.sent.at(-1)?.params.text).toContain('Страница 1 из 1')
  const all = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'sessions' && !s.action.query
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(all[0]))
  const select = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'session-select'
  )!
  await routeTelegramUpdate(h.ctx, telegramTestCallback(select[0]))
  const open = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'session-open'
  )!
  h.sessions[0]!.visible = false
  await expect(routeTelegramUpdate(h.ctx, telegramTestCallback(open[0]))).rejects.toThrow(
    'больше недоступна'
  )
  expect(h.send).not.toHaveBeenCalled()
})
