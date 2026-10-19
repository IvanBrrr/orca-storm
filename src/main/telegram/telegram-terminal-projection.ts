import { createHash } from 'node:crypto'
import type { RuntimeTerminalSummary } from '../../shared/runtime-terminal-contracts'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import type { TelegramSession } from './telegram-session-port'
import { selectFreshExplicitAgentStatusRow } from '../runtime/runtime-hook-agent-row-selection'

export function telegramTerminalSessionId(terminal: RuntimeTerminalSummary): string {
  const identity = [terminal.executionHostId, terminal.worktreeId, terminal.tabId, terminal.leafId]
  return `terminal:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`
}

export function projectTelegramTerminal(
  terminal: RuntimeTerminalSummary,
  rows: readonly AgentStatusIpcPayload[]
): { session: TelegramSession; items: AgentJournalRenderItem[] } {
  const id = telegramTerminalSessionId(terminal)
  const row = selectFreshExplicitAgentStatusRow({
    handles: [terminal.handle],
    paneKeys: [`${terminal.tabId}:${terminal.leafId}`],
    hookRows: rows.filter(
      (candidate) =>
        !candidate.structuredHost &&
        candidate.worktreeId === terminal.worktreeId &&
        candidate.agentType === terminal.agentIdentity
    )
  })
  const status =
    row?.state === 'working' ? 'working' : row?.state === 'done' ? 'idle' : row ? 'attention' : null
  const updatedAt = row?.receivedAt ?? terminal.lastOutputAt ?? 0
  const items: AgentJournalRenderItem[] = []
  if (row?.lastAssistantMessage && !row.lastAssistantMessageIsToolOutput && status === 'idle') {
    items.push({
      itemId: `terminal-message:${createHash('sha256')
        .update(`${row.turnStartedAt ?? row.stateStartedAt}:${row.lastAssistantMessage}`)
        .digest('hex')}`,
      revision: 1,
      sequence: 1,
      observedAt: updatedAt,
      body: {
        kind: 'message',
        role: 'assistant',
        state: 'completed',
        blocks: [{ type: 'text', text: row.lastAssistantMessage }]
      }
    })
  }
  if (status === 'attention') {
    items.push({
      itemId: `terminal-attention:${row?.stateStartedAt}`,
      revision: 1,
      sequence: 2,
      observedAt: updatedAt,
      body: {
        kind: 'message',
        role: 'assistant',
        state: 'completed',
        blocks: [
          {
            type: 'text',
            text: 'Агент ждёт ответа в терминале Storca. Открой Storca, чтобы проверить запрос и ответить.'
          }
        ]
      }
    })
  }
  return {
    session: {
      id,
      source: 'terminal',
      workspaceId: terminal.worktreeId,
      name: terminal.paneTitle || terminal.title || terminal.agentIdentity || 'Терминал',
      agent: terminal.agentIdentity ?? 'unknown',
      visible: true,
      updatedAt,
      turnStartedAt: row?.turnStartedAt ?? row?.stateStartedAt,
      status:
        terminal.agentIdentity === 'codex'
          ? {
              sessionId: id,
              workspaceId: terminal.worktreeId,
              agent: 'codex',
              status,
              latestPrompt: row?.prompt ?? '',
              updatedAt,
              statusStartedAt: row?.stateStartedAt,
              ...(status === 'working' && row?.toolName ? { toolName: row.toolName } : {}),
              ...(status === 'idle' && row?.mainAgent?.outcome
                ? { turnOutcome: row.mainAgent.outcome }
                : {})
            }
          : null
    },
    items
  }
}
