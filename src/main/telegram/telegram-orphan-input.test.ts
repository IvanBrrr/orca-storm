import { afterEach, expect, it, vi } from 'vitest'
import { createAgentPromptSubmissionRuntime } from '../runtime/agent-prompt-submission-runtime-test-fixture'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { TelegramTerminalSessions } from './telegram-terminal-sessions'
import { telegramTerminalSessionId } from './telegram-terminal-projection'

vi.mock('../git/worktree', () => {
  const worktree = {
    path: '/tmp/worktree-a',
    head: 'abc',
    branch: 'feature',
    isBare: false,
    isMainWorktree: false
  }
  return {
    listWorktrees: vi.fn(async () => [worktree]),
    listWorktreesStrict: vi.fn(async () => [worktree])
  }
})
let db: OrchestrationDb | undefined
afterEach(() => {
  db?.close()
  db = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('sends to the same live PTY after the renderer drops its pane, with durable replay and no reattachment', async () => {
  vi.useFakeTimers()
  const { runtime, writes } = await createAgentPromptSubmissionRuntime(() => undefined, 'codex')
  runtime.setPtyController({
    spawn: async () => ({ id: 'unused' }),
    write: (_id, data) => {
      writes.push(data)
      return true
    },
    kill: () => true,
    getForegroundProcess: async () => 'codex'
  })
  db = new OrchestrationDb(':memory:')
  vi.spyOn(runtime, 'getOrchestrationDb').mockReturnValue(db)
  const [before] = (await runtime.listTerminals()).terminals
  expect(before).toBeDefined()
  if (!before?.ptyId) {
    throw new Error('Test PTY missing')
  }
  runtime.attachWindow(1)
  runtime.syncWindowGraph(1, {
    tabs: [
      {
        tabId: before.tabId,
        worktreeId: before.worktreeId,
        title: 'VPN',
        activeLeafId: before.leafId,
        layout: null
      }
    ],
    leaves: [
      {
        tabId: before.tabId,
        worktreeId: before.worktreeId,
        leafId: before.leafId,
        paneRuntimeId: 1,
        ptyId: before.ptyId,
        paneTitle: null,
        title: 'VPN'
      }
    ]
  })
  runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
  const [orphan] = (await runtime.listTerminals()).terminals
  expect(orphan).toMatchObject({
    orphaned: true,
    ptyId: before.ptyId,
    recordedPaneKey: `${before.tabId}:${before.leafId}`
  })
  const port = new TelegramTerminalSessions(runtime)
  const [session] = await port.list()
  expect(session?.id).toBe(telegramTerminalSessionId(before))
  const body = {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Continue original conversation' }]
  } as const
  const input = { ...body, blocks: [...body.blocks] }
  const sent = expect(port.send(session!.id, 'same-topic-task', input)).resolves.toBeTypeOf(
    'boolean'
  )
  await vi.runAllTimersAsync()
  await sent
  const count = writes.length
  expect(writes.join('')).toContain('Continue original conversation')
  const replay = port.send(session!.id, 'same-topic-task', input)
  await vi.runAllTimersAsync()
  await replay
  expect(writes).toHaveLength(count)
  expect((await runtime.listTerminals()).terminals[0]?.orphaned).toBe(true)
})
