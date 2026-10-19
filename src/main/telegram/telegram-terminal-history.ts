import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import type { RuntimeTerminalSummary } from '../../shared/runtime-terminal-contracts'
import { isRootAgentJournalItem } from '../../shared/agent-session-journal-producer'
import { isNoiseMessage } from '../../shared/native-chat-noise'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { selectRuntimeHookAgentRowForPane } from '../runtime/runtime-mobile-agent-status-projection'
import { nativeChatTranscriptPathOnExecutionHost } from '../native-chat/ssh-transcript-path'
import { readNativeChatTranscriptTail } from '../native-chat/transcript-tail-reader'

export async function readTelegramTerminalHistory(
  runtime: OrcaRuntimeService,
  terminal: RuntimeTerminalSummary,
  signal: AbortSignal
): Promise<AgentJournalRenderItem[] | null> {
  const rows = runtime
    .getAgentProviderSessionRows()
    .filter(
      (row) =>
        !row.structuredHost &&
        row.worktreeId === terminal.worktreeId &&
        row.agentType === 'codex' &&
        (row.terminalHandle === terminal.handle ||
          row.paneKey === `${terminal.tabId}:${terminal.leafId}`)
    )
  const provider = selectRuntimeHookAgentRowForPane(rows).providerSession
  // A remote transcript without its attested path must never resolve on this machine.
  if (!provider?.id || !provider.transcriptPath) {
    return null
  }
  const source = rows.find((row) => row.providerSession === provider)
  if (terminal.executionHostId && terminal.executionHostId !== 'local' && !source?.connectionId) {
    return null
  }
  const scope = runtime.getOrchestrationDispatchAuthority(terminal.handle)?.hostScope
  const page = await readNativeChatTranscriptTail(
    {
      agent: 'codex',
      sessionId: provider.id,
      transcriptPath: nativeChatTranscriptPathOnExecutionHost(
        rows,
        provider.id,
        provider.transcriptPath
      ),
      limit: 200,
      ...(scope?.kind === 'wsl' ? { wslDistro: scope.distro } : {})
    },
    signal
  )
  if (!('messages' in page)) {
    return null
  }
  const items: AgentJournalRenderItem[] = []
  for (const message of page.messages) {
    if (
      !isRootAgentJournalItem(message) ||
      isNoiseMessage(message) ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      message.state === 'running'
    ) {
      continue
    }
    const text = message.blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n\n')
      .trim()
    if (!text) {
      continue
    }
    const previous = items.at(-1)
    if (
      previous?.body.kind === 'message' &&
      previous.body.role === message.role &&
      previous.body.blocks.some((block) => block.type === 'text' && block.text === text)
    ) {
      continue
    }
    items.push({
      itemId: `terminal-history:${provider.id}:${message.id}`,
      revision: 1,
      sequence: items.length + 1,
      observedAt: message.timestamp ?? 0,
      body: { kind: 'message', role: message.role, blocks: [{ type: 'text', text }] }
    })
  }
  return items
}
