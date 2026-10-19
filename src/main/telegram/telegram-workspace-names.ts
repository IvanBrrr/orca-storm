import type { OrcaRuntimeService } from '../runtime/orca-runtime'

export class TelegramWorkspaceNames {
  private names = new Map<string, string>()
  private refreshAt = 0
  private pending: Promise<void> | undefined

  constructor(private readonly runtime: OrcaRuntimeService) {}
  invalidate(): void {
    this.refreshAt = 0
  }

  async refresh(): Promise<void> {
    if (Date.now() < this.refreshAt) {
      return
    }
    this.pending ??= this.load().finally(() => {
      this.pending = undefined
    })
    await this.pending
  }

  private async load(): Promise<void> {
    try {
      const { worktrees } = await this.runtime.listManagedWorktrees(undefined, 10_000)
      const names = new Map(
        worktrees.map((workspace) => [
          workspace.id,
          workspace.displayName || workspace.branch || workspace.path
        ])
      )
      for (const folder of this.runtime.listFolderWorkspaces()) {
        names.set(folder.id, folder.name)
        names.set(`folder:${folder.id}`, folder.name)
      }
      this.names = names
      this.refreshAt = Date.now() + 30_000
    } catch {
      this.refreshAt = Date.now() + 5_000
    }
  }

  get(workspaceId: string): string {
    return (
      this.names.get(workspaceId) ??
      (workspaceId === 'global-floating-terminal'
        ? 'Общие терминалы'
        : (workspaceId.split(/[\\/]/).findLast((part) => part.length > 0) ?? workspaceId))
    )
  }
}
