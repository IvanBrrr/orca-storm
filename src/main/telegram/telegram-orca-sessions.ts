import { createHash } from 'node:crypto'
import { computeAgentSessionPayloadFingerprint } from '../../shared/agent-session-mutation-envelope'
import type {
  AgentSessionMutationEnvelope,
  AgentSessionMutationResult
} from '../../shared/agent-session-wire'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  prepareStructuredAgentSessionCreateForWorktree,
  commitStructuredAgentSessionCreate
} from '../runtime/rpc/methods/structured-agent-session-create'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { getAgentSessionAttachmentStore } from '../native-chat/agent-session-attachments/agent-session-attachment-store-registry'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { readTelegramOutputFiles } from './telegram-output-files'
import type {
  TelegramUserMessage,
  TelegramPromptResponse,
  TelegramSessionPort,
  TelegramWorkspace
} from './telegram-session-port'

const caller = { callerKey: 'telegram:owner' }

export class TelegramOrcaSessions implements TelegramSessionPort {
  constructor(
    private readonly runtime: OrcaRuntimeService,
    readonly transcribe: TelegramSessionPort['transcribe']
  ) {}

  private async host() {
    await this.runtime.ensureStructuredAgentSessionHost()
    const host = getStructuredAgentSessionHost()
    if (!host) {
      throw new Error('Сессии Orca пока недоступны.')
    }
    return host
  }
  async list() {
    const host = await this.host()
    await this.runtime.prepareStructuredAgentSessionStartupRestoration()
    const visible = new Set(host.deps.store.listVisibleSessionIds())
    return host.deps.store.listRecords().map((record) => {
      const status = host.readStatusSummary(record.sessionId)
      return {
        id: record.sessionId,
        workspaceId: record.location.workspaceId,
        name: record.conversationName ?? status?.latestPrompt?.slice(0, 80) ?? record.sessionId,
        agent: record.provider,
        visible: visible.has(record.sessionId),
        updatedAt: status?.updatedAt ?? record.updatedAt,
        status: status ?? null
      }
    })
  }
  async workspaces(): Promise<TelegramWorkspace[]> {
    const listing = await this.runtime.listManagedWorktrees(undefined, 500)
    const folders = this.runtime.listFolderWorkspaces()
    return [
      ...listing.worktrees.map((workspace) => ({
        id: workspace.id,
        name: workspace.displayName || workspace.branch || workspace.path
      })),
      ...folders.map((workspace) => ({ id: workspace.id, name: workspace.name }))
    ]
  }
  private async envelope(
    sessionId: string,
    clientOperationId: string,
    method: string,
    fields: Record<string, unknown>
  ): Promise<AgentSessionMutationEnvelope> {
    const record = (await this.host()).deps.store.getRecord(sessionId)
    if (!record) {
      throw new Error('Сессия не найдена в Orca.')
    }
    if (record.provider !== 'codex') {
      throw new Error('В этой версии Telegram поддерживает переписку только с Codex.')
    }
    return {
      sessionId,
      clientOperationId,
      expectedRuntimeFence: record.lease.runtimeFence,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({ method, sessionId, fields })
    }
  }
  async create(workspace: string, operationId: string): Promise<string> {
    const sessionId = `tg-${createHash('sha256').update(operationId).digest('hex').slice(0, 40)}`
    const fields = { worktree: `id:${workspace}`, agent: 'codex' }
    const envelope = {
      sessionId,
      clientOperationId: operationId,
      expectedRuntimeFence: null,
      payloadFingerprint: computeAgentSessionPayloadFingerprint({
        method: 'agentSession.create',
        sessionId,
        fields
      })
    }
    const prepared = await prepareStructuredAgentSessionCreateForWorktree({
      runtime: this.runtime,
      ensureHost: () => this.host(),
      caller,
      envelope,
      ...fields,
      atRest: true
    })
    const result = await commitStructuredAgentSessionCreate({
      runtime: this.runtime,
      caller,
      prepared,
      activate: false
    })
    unwrapTelegramSessionMutation(result)
    return sessionId
  }
  async history(sessionId: string) {
    const result = await (await this.host()).history({ sessionId, direction: 'tail', limit: 200 })
    return result.page.items
  }
  async prompt(sessionId: string, itemId: string) {
    return (await (await this.host()).journalSnapshot(sessionId)).items.find(
      (item) => item.itemId === itemId
    )
  }
  async pendingPrompts(sessionId: string) {
    const snapshot = await (await this.host()).journalSnapshot(sessionId)
    return snapshot.items.filter(
      (item) =>
        (item.body.kind === 'approval' || item.body.kind === 'question') &&
        item.body.resolution.state === 'pending'
    )
  }
  async hasPendingMessages(sessionId: string): Promise<boolean> {
    const { page } = await (await this.host()).history({ sessionId, direction: 'tail', limit: 40 })
    return Boolean(
      page.queuedMessages?.length ||
      page.submissions.some((submission) => submission.dispatchState === 'pending')
    )
  }
  async send(sessionId: string, operationId: string, body: TelegramUserMessage): Promise<boolean> {
    const fields = { body, delivery: 'queue-if-active' }
    const envelope = await this.envelope(sessionId, operationId, 'agentSession.send', fields)
    const result = await (
      await this.host()
    ).send(caller, { envelope, body, delivery: 'queue-if-active', userSend: true })
    const value = unwrapTelegramSessionMutation(result)
    return 'queued' in value
  }
  async stop(sessionId: string, operationId: string, turnId?: string): Promise<void> {
    const fields = turnId ? { turnId } : {}
    const envelope = await this.envelope(sessionId, operationId, 'agentSession.cancel', fields)
    unwrapTelegramSessionMutation(await (await this.host()).cancel(caller, { envelope, ...fields }))
  }
  async respond(
    sessionId: string,
    operationId: string,
    response: TelegramPromptResponse
  ): Promise<void> {
    const { kind, ...fields } = response
    const envelope = await this.envelope(
      sessionId,
      operationId,
      `agentSession.respondTo:${kind}`,
      fields
    )
    unwrapTelegramSessionMutation(
      await (await this.host()).respondToPrompt(caller, { envelope, ...response })
    )
  }
  async upload(sessionId: string, name: string, bytes: Buffer): Promise<string> {
    const host = await this.host()
    const record = host.deps.store.getRecord(sessionId)
    if (
      !record ||
      record.location.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
      record.location.wslDistro
    ) {
      throw new Error('Вложения для этой сессии нужно загрузить на её хост исполнения.')
    }
    const store = getAgentSessionAttachmentStore()
    if (!store) {
      throw new Error('Хранилище вложений недоступно.')
    }
    const upload = await store.startUpload({
      callerKey: caller.callerKey,
      sessionId,
      name,
      byteLength: bytes.length
    })
    try {
      for (let offset = 0; offset < bytes.length; offset += 128 * 1024) {
        await store.appendChunk({
          callerKey: caller.callerKey,
          uploadId: upload.uploadId,
          offset,
          contentBase64: bytes.subarray(offset, offset + 128 * 1024).toString('base64')
        })
      }
      return (await store.commitUpload({ callerKey: caller.callerKey, uploadId: upload.uploadId }))
        .path
    } catch (error) {
      await store.abortUpload({ callerKey: caller.callerKey, uploadId: upload.uploadId })
      throw error
    }
  }
  async outputFiles(sessionId: string, items: Parameters<TelegramSessionPort['outputFiles']>[1]) {
    const record = (await this.host()).deps.store.getRecord(sessionId)
    if (
      !record ||
      record.location.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
      record.location.wslDistro
    ) {
      return []
    }
    let directory = record.launchDirectory
    if (!directory) {
      directory = this.runtime
        .listFolderWorkspaces()
        .find((folder) => folder.id === record.location.workspaceId)?.folderPath
      directory ??= (await this.runtime.listManagedWorktrees(undefined, 500)).worktrees.find(
        (workspace) => workspace.id === record.location.workspaceId
      )?.path
    }
    return directory ? readTelegramOutputFiles(items, directory) : []
  }
}

function unwrapTelegramSessionMutation<T>(result: AgentSessionMutationResult<T>): T {
  if (!result.ok) {
    throw new Error(result.refusal.message)
  }
  return result.value
}
