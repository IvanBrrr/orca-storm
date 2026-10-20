import { expect, it, vi } from 'vitest'
import { z } from 'zod'
import { routeTelegramUpdate } from './telegram-update-router'
import {
  telegramTestCallback,
  telegramTestFixture,
  telegramTestMessage
} from './telegram-test-fixture'

const Keyboard = z.object({
  inline_keyboard: z.array(z.array(z.object({ text: z.string(), callback_data: z.string() })))
})

it('puts New worktree first and sorts existing workspaces by descending activity before pagination', async () => {
  const h = await telegramTestFixture()
  h.ctx.port.workspaces = async () => [
    { id: 'old', name: 'Old', activityAt: 1 },
    { id: 'recent', name: 'Recent', activityAt: 100 },
    { id: 'middle', name: 'Middle', activityAt: 50 }
  ]
  await routeTelegramUpdate(h.ctx, {
    update_id: 1,
    message: telegramTestMessage({ text: '/new', message_thread_id: undefined })
  })
  const menu = h.sent.find((entry) => entry.params.text === 'Где создать сессию Codex?')
  const rows = Keyboard.parse(menu?.params.reply_markup).inline_keyboard
  expect(rows.map((row) => row[0]?.text)).toEqual([
    'Новый ворктрии',
    'Продолжить существующую сессию',
    'Recent',
    'Middle',
    'Old'
  ])
})

it('creates a workspace and its Codex session from a bound name reply and does not repeat a completed request', async () => {
  const h = await telegramTestFixture()
  const createWorkspace = vi.spyOn(h.ctx.port, 'createWorkspace')
  const start = h.state.action({ kind: 'new-worktree', page: 0 })
  await routeTelegramUpdate(h.ctx, telegramTestCallback(start))
  const repoChoice = Object.entries(h.state.data.actions).find(
    ([, stored]) => stored.action.kind === 'worktree-repo'
  )
  expect(repoChoice).toBeDefined()
  await routeTelegramUpdate(h.ctx, telegramTestCallback(repoChoice![0]))
  const promptId = Number(Object.keys(h.state.data.replies)[0])
  const update = {
    update_id: 20,
    message: telegramTestMessage({
      text: 'Новый VPN',
      message_thread_id: undefined,
      reply_to_message: { message_id: promptId }
    })
  }
  await routeTelegramUpdate(h.ctx, update)
  await routeTelegramUpdate(h.ctx, update)
  expect(createWorkspace).toHaveBeenCalledExactlyOnceWith('repo-1', 'Новый VPN', expect.any(String))
  expect(h.create).toHaveBeenCalledExactlyOnceWith('workspace-1', expect.any(String))
  expect(h.state.data.topics['session-2']).toBeDefined()
})

it('keeps a creation retry pinned to the same operation after the session creation fails', async () => {
  const h = await telegramTestFixture()
  const createWorkspace = vi.spyOn(h.ctx.port, 'createWorkspace')
  h.create.mockRejectedValueOnce(new Error('temporary failure'))
  const key = h.state.action({ kind: 'worktree-name', repoId: 'repo-1' })
  h.state.data.replies['77'] = key
  const update = {
    update_id: 21,
    message: telegramTestMessage({
      text: 'VPN',
      message_thread_id: undefined,
      reply_to_message: { message_id: 77 }
    })
  }
  await expect(routeTelegramUpdate(h.ctx, update)).rejects.toThrow('temporary failure')
  await routeTelegramUpdate(h.ctx, update)
  expect(createWorkspace).toHaveBeenCalledTimes(2)
  expect(createWorkspace.mock.calls[0]?.[2]).toBe(createWorkspace.mock.calls[1]?.[2])
  expect(h.create.mock.calls[0]?.[1]).toBe(h.create.mock.calls[1]?.[1])
})

it('uses Storca in the session count', async () => {
  const h = await telegramTestFixture()
  await routeTelegramUpdate(h.ctx, {
    update_id: 30,
    message: telegramTestMessage({ text: '/sessions', message_thread_id: undefined })
  })
  expect(h.sent.some((entry) => String(entry.params.text).startsWith('Сессий Storca: 1.'))).toBe(
    true
  )
  expect(h.sent.some((entry) => String(entry.params.text).includes('Сессий Orca:'))).toBe(false)
})

it('accepts a plain next message as the worktree name after restart and requests Telegram ForceReply', async () => {
  const h = await telegramTestFixture()
  const createWorkspace = vi.spyOn(h.port, 'createWorkspace')
  const key = h.state.action({ kind: 'worktree-repo', repoId: 'repo-1' })
  await routeTelegramUpdate(h.ctx, telegramTestCallback(key))
  expect(h.sent.at(-1)?.params.reply_markup).toEqual({
    force_reply: true,
    input_field_placeholder: 'Название нового ворктрии'
  })
  await h.state.load()
  await routeTelegramUpdate(h.ctx, {
    update_id: 40,
    message: telegramTestMessage({
      text: 'Что как',
      message_thread_id: undefined,
      reply_to_message: { message_id: 74 }
    })
  })
  expect(createWorkspace).toHaveBeenCalledExactlyOnceWith('repo-1', 'Что как', expect.any(String))
  expect(h.state.data.topics['session-2']).toBeDefined()
  expect(h.sent.some((entry) => String(entry.params.text).startsWith('Выбери тему'))).toBe(false)
})

it('does not consume another topic or commands as a name, and cancels stale requests on /new', async () => {
  const h = await telegramTestFixture()
  const createWorkspace = vi.spyOn(h.port, 'createWorkspace')
  const key = h.state.action({ kind: 'worktree-name', repoId: 'repo-1' })
  h.state.data.replies['77'] = key
  await routeTelegramUpdate(h.ctx, {
    update_id: 41,
    message: telegramTestMessage({ text: 'Other topic', message_thread_id: 999 })
  })
  expect(createWorkspace).not.toHaveBeenCalled()
  await routeTelegramUpdate(h.ctx, {
    update_id: 42,
    message: telegramTestMessage({
      text: '/new',
      message_thread_id: undefined,
      reply_to_message: { message_id: 77 }
    })
  })
  expect(h.state.data.actions[key]?.used).toBe(true)
  expect(createWorkspace).not.toHaveBeenCalled()
  const another = h.state.action({ kind: 'worktree-name', repoId: 'repo-1' })
  await routeTelegramUpdate(h.ctx, {
    update_id: 43,
    message: telegramTestMessage({ text: '/cancel', message_thread_id: undefined })
  })
  expect(h.state.data.actions[another]?.used).toBe(true)
  expect(createWorkspace).not.toHaveBeenCalled()
})
