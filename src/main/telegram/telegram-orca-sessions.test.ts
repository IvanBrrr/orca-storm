import { afterEach, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  createRestTestRig,
  type RestTestRig
} from '../native-chat/agent-session-wire/structured-agent-session-rest-test-rig'
import {
  hostTestAttachParams,
  HOST_TEST_SESSION,
  hostTestOperationId
} from '../native-chat/agent-session-wire/structured-agent-session-host-test-data'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { TelegramOrcaSessions } from './telegram-orca-sessions'

let rig: RestTestRig | undefined
afterEach(async () => {
  setStructuredAgentSessionHost(null)
  await rig?.dispose()
  rig = undefined
  vi.restoreAllMocks()
})

it('replays a Telegram send through the real durable journal without a second provider dispatch', async () => {
  rig = await createRestTestRig({ idleSweep: { intervalMs: 60_000 } })
  setStructuredAgentSessionHost(rig.host)
  const attached = await rig.host.attach({ callerKey: 'client-1' }, hostTestAttachParams(null))
  expect(attached.ok).toBe(true)
  const runtime = new OrcaRuntimeService()
  vi.spyOn(runtime, 'ensureStructuredAgentSessionHost').mockResolvedValue()
  const sessions = new TelegramOrcaSessions(runtime, async () => '')
  const body = {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'Telegram task' }]
  } as const
  const message = { ...body, blocks: [...body.blocks] }
  const operationId = hostTestOperationId()
  await sessions.send(HOST_TEST_SESSION, operationId, message)
  await sessions.send(HOST_TEST_SESSION, operationId, message)
  const adapter = rig.adapter
  await vi.waitFor(() => expect(adapter.dispatch).toHaveBeenCalledTimes(1))
  const history = await rig.host.history({
    sessionId: HOST_TEST_SESSION,
    direction: 'tail',
    limit: 200
  })
  expect(
    history.page.submissions.filter((entry) => entry.clientMessageId === operationId)
  ).toHaveLength(1)
  await expect(
    sessions.send(HOST_TEST_SESSION, operationId, {
      kind: 'message',
      role: 'user',
      blocks: [{ type: 'text', text: 'changed task' }]
    })
  ).rejects.toThrow()
  expect(adapter.dispatch).toHaveBeenCalledTimes(1)
})

it('creates a visible chat at rest with host defaults and can send its first task', async () => {
  const current = await createRestTestRig({ idleSweep: { intervalMs: 60_000 } })
  rig = current
  setStructuredAgentSessionHost(current.host)
  const runtime = new OrcaRuntimeService()
  vi.spyOn(runtime, 'ensureStructuredAgentSessionHost').mockResolvedValue()
  vi.spyOn(runtime, 'resolveStructuredAgentSessionCreateIntent').mockImplementation(
    async (input) => {
      const { providerHandle: _handle, ...base } = hostTestAttachParams(null)
      return {
        ...base,
        envelope: { ...base.envelope, ...input.envelope },
        options: { model: 'host-default' }
      }
    }
  )
  vi.spyOn(runtime, 'prepareStructuredAgentSessionStartupRestoration').mockResolvedValue()
  vi.spyOn(runtime, 'listManagedWorktrees').mockResolvedValue({
    worktrees: [],
    totalCount: 0,
    truncated: false
  })
  vi.spyOn(runtime, 'listFolderWorkspaces').mockReturnValue([])
  vi.spyOn(runtime, 'listTerminals').mockResolvedValue({
    terminals: [],
    totalCount: 0,
    truncated: false
  })
  const publish = vi
    .spyOn(runtime, 'publishStructuredAgentSessionTab')
    .mockImplementation(async (args) => {
      await current.store.setSessionTabVisibility(args.sessionId, true)
    })
  const sessions = new TelegramOrcaSessions(runtime, async () => '')
  const createId = hostTestOperationId()
  const id = await sessions.create('workspace-1', createId)
  expect(await sessions.create('workspace-1', createId)).toBe(id)
  expect(current.store.listRecords()).toHaveLength(1)
  expect(current.store.listVisibleSessionIds()).toContain(id)
  expect(current.store.getRecord(id)?.options?.model).toBe('host-default')
  expect(publish).toHaveBeenCalledWith(expect.objectContaining({ sessionId: id, activate: false }))
  expect(current.adapter.acquire).not.toHaveBeenCalled()
  expect((await sessions.list())[0]?.name).toBe('Новая сессия Codex')
  await sessions.send(id, hostTestOperationId(), {
    kind: 'message',
    role: 'user',
    blocks: [{ type: 'text', text: 'First task' }]
  })
  await vi.waitFor(() => expect(current.adapter.dispatch).toHaveBeenCalledTimes(1))
})

it('lists existing terminal sessions alongside native chats when the native store is empty', async () => {
  rig = await createRestTestRig({ idleSweep: { intervalMs: 60_000 } })
  setStructuredAgentSessionHost(rig.host)
  const runtime = new OrcaRuntimeService()
  vi.spyOn(runtime, 'ensureStructuredAgentSessionHost').mockResolvedValue()
  vi.spyOn(runtime, 'prepareStructuredAgentSessionStartupRestoration').mockResolvedValue()
  vi.spyOn(runtime, 'listManagedWorktrees').mockResolvedValue({
    worktrees: [],
    totalCount: 0,
    truncated: false
  })
  vi.spyOn(runtime, 'listFolderWorkspaces').mockReturnValue([])
  vi.spyOn(runtime, 'listTerminals').mockResolvedValue({
    terminals: [
      {
        handle: 'term-codex',
        ptyId: 'pty-codex',
        worktreeId: 'repo::/work/ВПН ФЕЙЛ КЛОСЕД',
        worktreePath: '/work/ВПН ФЕЙЛ КЛОСЕД',
        branch: 'feature',
        tabId: 'tab-codex',
        leafId: 'leaf-codex',
        title: 'Проработать концепцию VPN',
        connected: true,
        writable: true,
        lastOutputAt: null,
        preview: '',
        agentIdentity: 'codex',
        executionHostId: 'local'
      }
    ],
    totalCount: 1,
    truncated: false
  })
  const sessions = new TelegramOrcaSessions(runtime, async () => '')
  const listed = await sessions.list()
  expect(listed).toHaveLength(1)
  expect(listed[0]).toMatchObject({
    source: 'terminal',
    agent: 'codex',
    visible: true,
    name: 'Проработать концепцию VPN',
    workspaceName: 'ВПН ФЕЙЛ КЛОСЕД'
  })
})
