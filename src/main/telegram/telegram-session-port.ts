import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import type { AgentSessionQuestionAnswer } from '../../shared/agent-session-question-answer'
import type { AgentSessionStatusSummary } from '../../shared/agent-session-wire'
import type { z } from 'zod'
import type { SendBodyStructure } from '../../shared/rpc-contract/structured-agent-session-message-params'

export type TelegramUserMessage = z.infer<typeof SendBodyStructure>

export type TelegramSession = {
  id: string
  source?: 'terminal'
  workspaceId: string
  workspaceName?: string
  name: string
  agent: string
  visible: boolean
  updatedAt: number
  turnStartedAt?: number
  status: AgentSessionStatusSummary | null
}
export type TelegramWorkspace = { id: string; name: string; activityAt?: number }
export type TelegramPromptResponse = {
  itemId: string
  expectedRevision: number
  kind: 'approval' | 'question'
  optionId?: string
  answers?: AgentSessionQuestionAnswer[]
}
export type TelegramSessionPort = {
  list(): Promise<TelegramSession[]>
  workspaces(): Promise<TelegramWorkspace[]>
  repositories(): Promise<TelegramWorkspace[]>
  createWorkspace(repoId: string, name: string, operationId: string): Promise<string>
  create(workspace: string, operationId: string): Promise<string>
  history(sessionId: string): Promise<AgentJournalRenderItem[]>
  recentHistory?(sessionId: string, signal: AbortSignal): Promise<AgentJournalRenderItem[] | null>
  progress?(sessionId: string): Promise<{ key: string; start: string; lines: string[] }>
  pendingPrompts(sessionId: string): Promise<AgentJournalRenderItem[]>
  hasPendingMessages(sessionId: string): Promise<boolean>
  prompt(sessionId: string, itemId: string): Promise<AgentJournalRenderItem | undefined>
  send(sessionId: string, operationId: string, body: TelegramUserMessage): Promise<boolean>
  stop(sessionId: string, operationId: string, turnId?: string): Promise<void>
  respond(sessionId: string, operationId: string, response: TelegramPromptResponse): Promise<void>
  upload(sessionId: string, name: string, bytes: Buffer): Promise<string>
  outputFiles(
    sessionId: string,
    items: AgentJournalRenderItem[]
  ): Promise<{ name: string; bytes: Buffer }[]>
  transcribe(bytes: Buffer, signal: AbortSignal): Promise<string>
}
