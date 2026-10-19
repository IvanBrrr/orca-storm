import { afterEach, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { OrchestrationDb } from '../runtime/orchestration/db'
import type {
  RuntimeTerminalListResult,
  RuntimeTerminalSummary
} from '../../shared/runtime-terminal-contracts'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import { TelegramTerminalSessions } from './telegram-terminal-sessions'
import { telegramTerminalSessionId } from './telegram-terminal-projection'
import { createAgentPromptSubmissionRuntime } from '../runtime/agent-prompt-submission-runtime-test-fixture'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { TERMINAL_SEND_METHODS } from '../runtime/rpc/methods/terminal/terminal-send-method'

vi.mock('../git/worktree', () => ({
  listWorktrees: vi.fn().mockResolvedValue([
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/test',
      isBare: false,
      isMainWorktree: false
    }
  ]),
  listWorktreesStrict: vi.fn().mockResolvedValue([
    {
      path: '/tmp/worktree-a',
      head: 'abc',
      branch: 'feature/test',
      isBare: false,
      isMainWorktree: false
    }
  ])
}))

let db: OrchestrationDb | undefined
afterEach(() => {
  db?.close()
  db = undefined
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function terminal(overrides: Partial<RuntimeTerminalSummary> = {}): RuntimeTerminalSummary {
  return {
    handle: 'term-one',
    ptyId: 'pty-one',
    incarnationId: 'incarnation-one',
    worktreeId: 'repo::/work/project',
    worktreePath: '/work/project',
    branch: 'feature',
    tabId: 'tab-one',
    leafId: 'leaf-one',
    title: 'Conversation',
    connected: true,
    writable: true,
    lastOutputAt: null,
    preview: '',
    agentIdentity: 'codex',
    executionHostId: 'local',
    ...overrides
  }
}
function listing(
  terminals: RuntimeTerminalSummary[],
  overrides: Partial<RuntimeTerminalListResult> = {}
): RuntimeTerminalListResult {
  return {
    terminals,
    totalCount: terminals.length,
    truncated: false,
    hostScope: { hostIds: ['local'], omittedHostIds: [] },
    ...overrides
  }
}
function row(overrides: Partial<AgentStatusIpcPayload> = {}): AgentStatusIpcPayload {
  return {
    paneKey: 'tab-one:leaf-one',
    worktreeId: 'repo::/work/project',
    connectionId: null,
    state: 'done',
    agentType: 'codex',
    prompt: 'Task',
    receivedAt: Date.now(),
    stateStartedAt: Date.now(),
    ...overrides
  }
}

it('lists terminal agents with hook replies, excludes shells/orphans, and keeps ids when handles change', async () => {
  const rows = [row({ lastAssistantMessage: 'Finished the task' })]
  const runtime = new OrcaRuntimeService(null, undefined, { getAgentStatusSnapshot: () => rows })
  const one = terminal()
  const list = vi
    .spyOn(runtime, 'listTerminals')
    .mockResolvedValue(
      listing([
        one,
        terminal({ handle: 'shell', agentIdentity: undefined }),
        terminal({ handle: 'orphan', orphaned: true })
      ])
    )
  vi.spyOn(runtime.orchestrationSenderNames, 'nameOf').mockReturnValue('Saved session title')
  const port = new TelegramTerminalSessions(runtime)
  const sessions = await port.list()
  expect(sessions).toHaveLength(1)
  expect(sessions[0]).toMatchObject({
    name: 'Saved session title',
    agent: 'codex',
    status: { status: 'idle' }
  })
  expect(port.history(sessions[0]!.id)[0]?.body).toMatchObject({
    kind: 'message',
    role: 'assistant',
    blocks: [{ type: 'text', text: 'Finished the task' }]
  })
  list.mockResolvedValue(listing([{ ...one, handle: 'term-after-restart' }]))
  expect((await port.list())[0]?.id).toBe(sessions[0]?.id)
  expect(telegramTerminalSessionId(terminal({ leafId: 'second-pane' }))).not.toBe(sessions[0]?.id)
})

it('retains an unavailable host without treating loss of contact or a truncated listing as closure', async () => {
  const runtime = new OrcaRuntimeService()
  const list = vi.spyOn(runtime, 'listTerminals').mockResolvedValue(listing([terminal()]))
  const port = new TelegramTerminalSessions(runtime)
  await port.list()
  list.mockResolvedValue(listing([], { hostScope: { hostIds: [], omittedHostIds: ['local'] } }))
  expect((await port.list())[0]).toMatchObject({ visible: true, status: null })
  list.mockResolvedValue(listing([], { truncated: true }))
  expect((await port.list())[0]?.visible).toBe(true)
  list.mockResolvedValue(listing([]))
  expect((await port.list())[0]?.visible).toBe(false)
})

it('never publishes partial prose, tool output, or unconfirmed restored state as a completed answer', async () => {
  const rows = [row({ state: 'working', lastAssistantMessage: 'In progress' })]
  const runtime = new OrcaRuntimeService(null, undefined, { getAgentStatusSnapshot: () => rows })
  vi.spyOn(runtime, 'listTerminals').mockResolvedValue(listing([terminal()]))
  const port = new TelegramTerminalSessions(runtime)
  const [session] = await port.list()
  expect(port.history(session!.id)).toEqual([])
  rows[0] = row({ lastAssistantMessage: 'Tool output', lastAssistantMessageIsToolOutput: true })
  await port.list()
  expect(port.history(session!.id)).toEqual([])
  rows[0] = row({ lastAssistantMessage: 'Old reply', restoredUnconfirmed: true })
  expect((await port.list())[0]?.status?.status).toBeNull()
  expect(port.history(session!.id)).toEqual([])
})

it('uses the real prompt path and durable RPC receipt so a repeated Telegram update writes only once', async () => {
  vi.useFakeTimers()
  const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
    () => undefined,
    'codex'
  )
  db = new OrchestrationDb(':memory:')
  vi.spyOn(runtime, 'getOrchestrationDb').mockReturnValue(db)
  vi.spyOn(runtime, 'getTerminalAgentStatus').mockResolvedValue({
    handle,
    isRunningAgent: true,
    status: 'idle'
  })
  const port = new TelegramTerminalSessions(runtime)
  const [session] = await port.list()
  expect(session).toBeDefined()
  const body = {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Task from Telegram' }]
  } as const
  const message = { ...body, blocks: [...body.blocks] }
  const sent = expect(port.send(session!.id, 'telegram-update-one', message)).resolves.toBeTypeOf(
    'boolean'
  )
  await vi.runAllTimersAsync()
  await sent
  const afterSend = writes.length
  expect(afterSend).toBeGreaterThan(0)
  const replay = port.send(session!.id, 'telegram-update-one', message)
  await vi.runAllTimersAsync()
  await replay
  expect(writes).toHaveLength(afterSend)
  expect(writes.join('')).toContain('Task from Telegram')
  expect(handle).toBeDefined()
  const mismatch = port.send(session!.id, 'telegram-update-one', {
    ...message,
    blocks: [{ type: 'text', text: 'Different task' }]
  })
  const rejected = expect(mismatch).rejects.toThrow()
  await vi.runAllTimersAsync()
  await rejected
  expect(writes).toHaveLength(afterSend)
})

it('refuses to type a Telegram task into an approval prompt or a shell', async () => {
  const runtime = new OrcaRuntimeService()
  vi.spyOn(runtime, 'listTerminals').mockResolvedValue(listing([terminal()]))
  const resolve = vi.spyOn(runtime, 'getOrchestrationDispatchAuthority').mockReturnValue(null)
  const send = vi.spyOn(runtime, 'sendTerminalAgentPrompt')
  const port = new TelegramTerminalSessions(runtime)
  const [session] = await port.list()
  await expect(
    port.send(session!.id, 'refused', {
      kind: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: 'Task' }]
    })
  ).rejects.toThrow('terminal_guard_not_writable')
  expect(resolve).toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
})

it('does not send task text into a terminal approval prompt', async () => {
  const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
    () => undefined,
    'codex'
  )
  vi.spyOn(runtime, 'getDriver').mockReturnValue({ kind: 'mobile', clientId: 'phone-one' })
  vi.spyOn(runtime, 'getTerminalAgentStatus').mockResolvedValue({
    handle,
    isRunningAgent: true,
    status: 'permission'
  })
  const port = new TelegramTerminalSessions(runtime)
  const [session] = await port.list()
  const before = writes.length
  await expect(
    port.send(session!.id, 'approval-blocked', {
      kind: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: 'A new task' }]
    })
  ).rejects.toThrow('terminal_guard_permission')
  expect(writes).toHaveLength(before)
})

it('accepts the owner Telegram prompt while a phone owns the viewport without taking its input floor', async () => {
  vi.useFakeTimers()
  const { runtime, handle, writes } = await createAgentPromptSubmissionRuntime(
    () => undefined,
    'codex'
  )
  db = new OrchestrationDb(':memory:')
  vi.spyOn(runtime, 'getOrchestrationDb').mockReturnValue(db)
  const driver = vi
    .spyOn(runtime, 'getDriver')
    .mockReturnValue({ kind: 'mobile', clientId: 'phone-one' })
  const floor = vi.spyOn(runtime, 'beginMobileInputFloor')
  vi.spyOn(runtime, 'getTerminalAgentStatus').mockResolvedValue({
    handle,
    isRunningAgent: true,
    status: 'idle'
  })
  const untrusted = await new RpcDispatcher({ runtime, methods: TERMINAL_SEND_METHODS }).dispatch({
    id: 'untrusted-ui-input',
    authToken: '',
    method: 'terminal.send',
    params: {
      terminal: handle,
      text: 'Must remain blocked',
      enter: true,
      agentPrompt: true,
      client: { id: 'telegram:owner', type: 'desktop' },
      terminalInputOrigin: 'owner-automation'
    }
  })
  expect(untrusted).toMatchObject({
    ok: true,
    result: { send: { accepted: false, bytesWritten: 0 } }
  })
  expect(writes.join('')).not.toContain('Must remain blocked')
  const port = new TelegramTerminalSessions(runtime)
  const [session] = await port.list()
  const sent = expect(
    port.send(session!.id, 'telegram-phone-open', {
      kind: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: 'Continue from Telegram' }]
    })
  ).resolves.toBeTypeOf('boolean')
  await vi.runAllTimersAsync()
  await sent
  expect(writes.join('')).toContain('Continue from Telegram')
  expect(floor).not.toHaveBeenCalled()
  expect(driver).toHaveReturnedWith({ kind: 'mobile', clientId: 'phone-one' })
})
