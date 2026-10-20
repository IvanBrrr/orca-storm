import { expect, it, vi } from 'vitest'
import { routeTelegramUpdate } from './telegram-update-router'
import { TelegramTerminalSessions } from './telegram-terminal-sessions'
import { telegramTerminalSessionId } from './telegram-terminal-projection'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RuntimeTerminalSummary } from '../../shared/runtime-terminal-contracts'
import {
  telegramTestCallback,
  telegramTestFixture,
  telegramTestMessage
} from './telegram-test-fixture'

const terminal: RuntimeTerminalSummary = {
  handle: 'term-live',
  ptyId: 'pty-live',
  incarnationId: 'inc-live',
  executionHostId: 'local',
  worktreeId: 'folder:project',
  worktreePath: '/work/project',
  branch: '',
  tabId: 'saved-tab',
  leafId: '11111111-1111-4111-8111-111111111111',
  title: 'VPN isolation',
  agentIdentity: 'codex',
  connected: true,
  writable: true,
  preview: '',
  lastOutputAt: null
}
const orphan = {
  ...terminal,
  orphaned: true,
  recordedPaneKey: `${terminal.tabId}:${terminal.leafId}`,
  tabId: 'pty:pty-live',
  leafId: 'pty:pty-live',
  title: null
}

it('keeps the topic identity for a host-attested orphan on a cold start and after reattachment', async () => {
  const runtime = new OrcaRuntimeService()
  const listing = vi.spyOn(runtime, 'listTerminals').mockResolvedValue({
    terminals: [orphan],
    totalCount: 1,
    truncated: false,
    hostScope: { hostIds: ['local'], omittedHostIds: [] }
  })
  const port = new TelegramTerminalSessions(runtime)
  const [session] = await port.list()
  expect(session?.id).toBe(telegramTerminalSessionId(terminal))
  expect(session?.visible).toBe(true)
  const h = await telegramTestFixture()
  h.sessions.splice(0, 1, { ...session!, name: 'VPN isolation' })
  await h.ctx.refresh()
  const topic = await h.ctx.topic(h.sessions[0]!)
  await h.state.load()
  h.state.action({ kind: 'session-query' }, topic.threadId)
  await routeTelegramUpdate(h.ctx, {
    update_id: 1,
    message: telegramTestMessage({
      message_thread_id: topic.threadId,
      reply_to_message: { message_id: 74 },
      text: 'Continue VPN task'
    })
  })
  expect(h.send).toHaveBeenCalledExactlyOnceWith(session!.id, expect.any(String), {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Continue VPN task' }]
  })
  expect(h.sent.some((s) => String(s.params.text).startsWith('Сессий Storca:'))).toBe(false)
  listing.mockResolvedValue({ terminals: [terminal], totalCount: 1, truncated: false })
  expect((await port.list())[0]?.id).toBe(session?.id)
})

it('does not map unattested or conflicting orphan processes onto an existing conversation', async () => {
  const runtime = new OrcaRuntimeService()
  vi.spyOn(runtime, 'listTerminals').mockResolvedValue({
    terminals: [
      { ...orphan, recordedPaneKey: undefined },
      { ...orphan, recordedPaneKey: 'bad-pane' },
      { ...orphan, executionHostId: undefined },
      { ...orphan, agentIdentity: undefined },
      { ...orphan, handle: 'old-process', ptyId: 'old-pty' },
      terminal
    ],
    totalCount: 6,
    truncated: false
  })
  const port = new TelegramTerminalSessions(runtime)
  expect(await port.list()).toHaveLength(1)
  const read = vi.spyOn(runtime, 'readTerminal').mockResolvedValue({
    handle: terminal.handle,
    status: 'running',
    tail: [],
    truncated: false,
    nextCursor: null
  })
  await port.progress(telegramTerminalSessionId(terminal))
  expect(read).toHaveBeenCalledWith(terminal.handle, { limit: 100 })
})

it('preserves the same-session draft during unavailable inventory instead of opening a chooser', async () => {
  const h = await telegramTestFixture()
  const session = h.sessions[0]!
  const topic = await h.ctx.topic(session)
  h.sessions.splice(0)
  await routeTelegramUpdate(h.ctx, {
    update_id: 3,
    message: telegramTestMessage({ message_thread_id: topic.threadId, text: 'Saved task' })
  })
  expect(h.send).not.toHaveBeenCalled()
  expect(h.sent.at(-1)?.params.text).toContain('не может подтвердить её доступность')
  expect(h.sent.some((s) => String(s.params.text).startsWith('Сессий Storca:'))).toBe(false)
  const retry = Object.entries(h.state.data.actions).find(
    ([, s]) => s.action.kind === 'session-open' && !!s.action.draftKey
  )!
  await h.state.load()
  h.sessions.push(session)
  await routeTelegramUpdate(h.ctx, telegramTestCallback(retry[0], topic.threadId))
  expect(h.sent.some((s) => s.params.text === 'Сообщение принято Storca.')).toBe(true)
  await routeTelegramUpdate(h.ctx, telegramTestCallback(retry[0], topic.threadId))
  expect(h.send).toHaveBeenCalledExactlyOnceWith(session.id, expect.any(String), {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Saved task' }]
  })
})

it('does not choose between two live orphan processes claiming the same former pane', async () => {
  const runtime = new OrcaRuntimeService()
  const list = vi
    .spyOn(runtime, 'listTerminals')
    .mockResolvedValue({ terminals: [orphan], totalCount: 1, truncated: false })
  const port = new TelegramTerminalSessions(runtime)
  expect(await port.list()).toHaveLength(1)
  list.mockResolvedValue({
    terminals: [orphan, { ...orphan, handle: 'other', ptyId: 'another-pty' }],
    totalCount: 2,
    truncated: false
  })
  expect(await port.list()).toHaveLength(0)
  await expect(port.progress(telegramTerminalSessionId(terminal))).rejects.toThrow('недоступна')
})
