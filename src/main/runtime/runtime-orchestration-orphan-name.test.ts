import { expect, it } from 'vitest'
import { RuntimeOrchestrationSenderNames } from './runtime-orchestration-sender-names'

it('keeps the saved conversation name when a live PTY loses its UI surface', () => {
  const names = new RuntimeOrchestrationSenderNames({
    getDb: () => null,
    getHandleRecord: () => ({
      worktreeId: 'folder:project',
      tabId: 'pty:live-process',
      ptyId: 'live-process'
    }),
    getPtyAgents: () => ({ launchAgent: 'codex' }),
    getTerminalPaneKey: () => 'saved-tab:11111111-1111-4111-8111-111111111111',
    getWorkspaceSession: () => ({
      tabsByWorktree: {
        'folder:project': [{ id: 'saved-tab', title: 'Codex', customTitle: 'VPN isolation' }]
      }
    }),
    getGeneratedTitlesEnabled: () => true,
    getAgentStatusSnapshotForPane: () => [],
    getTrackedTitle: () => null
  })
  expect(
    names.nameOf({ address: 'term-live', terminalHandle: 'term-live', orcaSessionId: null })
  ).toBe('VPN isolation')
})
