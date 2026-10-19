import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { RuntimeTerminalSummary } from '../../shared/runtime-terminal-contracts'
import { readTelegramTerminalHistory } from './telegram-terminal-history'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const terminal: RuntimeTerminalSummary = {
  handle: 'term-one',
  ptyId: 'pty-one',
  worktreeId: 'folder:project',
  worktreePath: '/work/project',
  branch: '',
  tabId: 'tab-one',
  leafId: 'leaf-one',
  title: 'Task',
  connected: true,
  writable: true,
  lastOutputAt: null,
  preview: '',
  agentIdentity: 'codex',
  executionHostId: 'local'
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'telegram-history-'))
  roots.push(root)
  const path = join(root, 'rollout-session.jsonl')
  const events = [
    { type: 'user_message', message: 'Please inspect the code' },
    { type: 'agent_message', message: 'Inspecting' },
    { type: 'agent_message', message: 'Inspecting' },
    { type: 'function_call_output', output: 'Tool output should not appear' },
    { type: 'agent_message', message: 'Done' }
  ]
  await writeFile(
    path,
    `${events.map((payload) => JSON.stringify({ type: 'event_msg', payload })).join('\n')}\n`
  )
  const rows: AgentStatusIpcPayload[] = [
    {
      paneKey: 'tab-one:leaf-one',
      worktreeId: terminal.worktreeId,
      connectionId: null,
      state: 'done',
      agentType: 'codex',
      prompt: '',
      receivedAt: 1,
      stateStartedAt: 1,
      restoredUnconfirmed: true,
      providerSession: { key: 'session_id', id: 'session', transcriptPath: path }
    }
  ]
  const runtime = new OrcaRuntimeService(null, undefined, {
    getAgentProviderSessionSnapshot: () => rows
  })
  return { rows, runtime }
}

it('reads the attested conversation tail even when live status is stale and drops duplicate prose', async () => {
  const h = await fixture()
  const items = await readTelegramTerminalHistory(h.runtime, terminal, new AbortController().signal)
  expect(items?.map((item) => item.body.kind === 'message' && item.body.blocks)).toEqual([
    [{ type: 'text', text: 'Please inspect the code' }],
    [{ type: 'text', text: 'Inspecting' }],
    [{ type: 'text', text: 'Done' }]
  ])
  expect(items?.[0]?.body).toMatchObject({ role: 'user' })
})

it('does not read a local same-named file for an SSH session or another pane', async () => {
  const h = await fixture()
  h.rows[0]!.connectionId = 'ssh-unavailable-host'
  expect(
    await readTelegramTerminalHistory(h.runtime, terminal, new AbortController().signal)
  ).toBeNull()
  h.rows[0]!.connectionId = null
  h.rows[0]!.paneKey = 'other-tab:other-leaf'
  expect(
    await readTelegramTerminalHistory(h.runtime, terminal, new AbortController().signal)
  ).toBeNull()
})
