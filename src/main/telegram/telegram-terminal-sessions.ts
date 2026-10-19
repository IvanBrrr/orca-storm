import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { getAppEnvironment } from '../../shared/app-environment'
import { sanitizeAgentSessionAttachmentName } from '../../shared/agent-session-attachments'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../shared/protocol-version'
import type { RuntimeTerminalSummary } from '../../shared/runtime-terminal-contracts'
import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { TERMINAL_SEND_METHODS } from '../runtime/rpc/methods/terminal/terminal-send-method'
import { assertTerminalAgentSendable } from '../runtime/rpc/terminal-agent-send-guard'
import { readTelegramOutputFiles } from './telegram-output-files'
import type { TelegramSession, TelegramUserMessage } from './telegram-session-port'
import { projectTelegramTerminal } from './telegram-terminal-projection'
import { readTelegramTerminalHistory } from './telegram-terminal-history'
import { TelegramInputNotDeliveredError } from './telegram-input-refusal'

const SendResult = z.object({
  send: z.object({
    accepted: z.boolean(),
    bytesWritten: z.number().nonnegative().optional(),
    writeSettlement: z.object({ outcome: z.string() }).optional(),
    refusedReason: z.enum(['no-agent', 'permission']).optional(),
    prompt: z.object({ stages: z.array(z.string()), observation: z.string() }).optional()
  })
})

type TerminalEntry = {
  terminal: RuntimeTerminalSummary
  session: TelegramSession
  items: AgentJournalRenderItem[]
}

export class TelegramTerminalSessions {
  private readonly entries = new Map<string, TerminalEntry>()
  private readonly dispatcher: RpcDispatcher

  constructor(private readonly runtime: OrcaRuntimeService) {
    this.dispatcher = new RpcDispatcher({ runtime, methods: TERMINAL_SEND_METHODS })
  }

  async list(): Promise<TelegramSession[]> {
    const listing = await this.runtime.listTerminals(undefined, 10_000)
    const rows = this.runtime.getAgentStatusSnapshotFn?.() ?? []
    const found = new Set<string>()
    for (const terminal of listing.terminals) {
      if (terminal.orphaned || !terminal.agentIdentity || !terminal.tabId || !terminal.leafId) {
        continue
      }
      const projection = projectTelegramTerminal(terminal, rows)
      projection.session.name =
        this.runtime.orchestrationSenderNames.nameOf({
          address: terminal.handle,
          terminalHandle: terminal.handle,
          orcaSessionId: null
        }) ?? projection.session.name
      found.add(projection.session.id)
      this.entries.set(projection.session.id, { terminal, ...projection })
    }
    for (const [id, entry] of this.entries) {
      if (!found.has(id)) {
        const covered =
          !listing.truncated &&
          entry.terminal.executionHostId &&
          listing.hostScope?.hostIds.includes(entry.terminal.executionHostId)
        entry.session = {
          ...entry.session,
          visible: covered ? false : entry.session.visible,
          status: null
        }
      }
    }
    return [...this.entries.values()].map((entry) => entry.session)
  }

  history(id: string): AgentJournalRenderItem[] {
    return this.entry(id).items
  }

  recentHistory(id: string, signal: AbortSignal): Promise<AgentJournalRenderItem[] | null> {
    return readTelegramTerminalHistory(this.runtime, this.entry(id).terminal, signal)
  }

  async progress(id: string) {
    const { terminal, session } = this.entry(id)
    const read = await this.runtime.readTerminal(terminal.handle, { limit: 100 })
    return {
      key: String(session.turnStartedAt ?? session.status?.statusStartedAt ?? 0),
      start: session.status?.latestPrompt ?? '',
      lines: read.tail.slice(-100)
    }
  }

  private entry(id: string): TerminalEntry {
    const entry = this.entries.get(id)
    if (!entry?.session.visible) {
      throw new Error('Терминальная сессия больше недоступна. Используй /sessions.')
    }
    return entry
  }

  async send(id: string, operationId: string, body: TelegramUserMessage): Promise<boolean> {
    const terminal = this.entry(id).terminal
    const text = body.blocks
      .map((block) => {
        if (block.type === 'text') {
          return block.text
        }
        if (block.type === 'image-ref' && block.path) {
          return block.path
        }
        throw new Error('Этот тип вложения нельзя передать терминальному Codex.')
      })
      .join('\n\n')
    await assertTerminalAgentSendable({
      runtime: this.runtime,
      handle: terminal.handle,
      assertWritable: () => {
        const current = this.runtime.getOrchestrationDispatchAuthority(terminal.handle)
        if (!current?.ptyId || current.ptyId !== terminal.ptyId) {
          throw new Error('terminal_guard_not_writable')
        }
      }
    })
    const send = await this.dispatch(operationId, {
      terminal: terminal.handle,
      text,
      enter: true,
      agentPrompt: true,
      waitSubmitMs: 0,
      client: { id: 'telegram:owner', type: 'desktop' }
    })
    return !send.prompt?.stages.includes('turn_started')
  }

  async stop(id: string, operationId: string): Promise<void> {
    const terminal = this.entry(id).terminal
    if (!(await this.runtime.getTerminalAgentStatus(terminal.handle)).isRunningAgent) {
      throw new Error('Агент в этом терминале больше не запущен.')
    }
    await this.dispatch(operationId, {
      terminal: terminal.handle,
      interrupt: true,
      requireWriteSettlement: true,
      client: { id: 'telegram:owner', type: 'desktop' }
    })
  }

  private async dispatch(operationId: string, params: Record<string, unknown>) {
    const response = await this.dispatcher.dispatch(
      {
        id: operationId,
        authToken: '',
        method: 'terminal.send',
        params,
        orchestrationRequestId: operationId,
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION
      },
      { authenticatedCallerFingerprint: 'telegram:owner', terminalInputOrigin: 'owner-automation' }
    )
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    const { send } = SendResult.parse(response.result)
    if (!send.accepted) {
      const message =
        send.refusedReason === 'permission'
          ? 'Codex ждёт разрешения в терминале. Сообщение не передано. Подтверди запрос в Storca и отправь его снова.'
          : send.refusedReason === 'no-agent'
            ? 'Codex больше не запущен в этом терминале. Сообщение не передано. Запусти сессию в Storca.'
            : 'Storca не подтвердила передачу ввода в терминал. Проверь связь с хостом и состояние сессии.'
      if (
        send.bytesWritten === 0 &&
        (!send.writeSettlement || send.writeSettlement.outcome === 'refused')
      ) {
        throw new TelegramInputNotDeliveredError(message)
      }
      throw new Error(message)
    }
    return send
  }

  async upload(id: string, name: string, bytes: Buffer): Promise<string> {
    const terminal = this.entry(id).terminal
    if (
      terminal.executionHostId !== LOCAL_EXECUTION_HOST_ID ||
      this.runtime.getOrchestrationDispatchAuthority(terminal.handle)?.hostScope.kind !== 'local'
    ) {
      throw new Error('Вложения для этого терминала нужно загрузить на его хост исполнения.')
    }
    const folder = await mkdtemp(join(getAppEnvironment().getPath('temp'), 'orca-telegram-'))
    const path = join(folder, sanitizeAgentSessionAttachmentName(name))
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' })
    return path
  }

  async outputFiles(id: string, items: AgentJournalRenderItem[]) {
    const terminal = this.entry(id).terminal
    return terminal.executionHostId === LOCAL_EXECUTION_HOST_ID &&
      this.runtime.getOrchestrationDispatchAuthority(terminal.handle)?.hostScope.kind === 'local' &&
      terminal.worktreePath
      ? readTelegramOutputFiles(items, terminal.worktreePath)
      : []
  }
}
