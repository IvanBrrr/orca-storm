import { z } from 'zod'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { WORKTREE_METHODS } from '../runtime/rpc/methods/worktree'
import type { TelegramWorkspace } from './telegram-session-port'

const CreatedWorktree = z.object({ worktree: z.object({ id: z.string() }) })

export class TelegramWorkspaces {
  private readonly dispatcher: RpcDispatcher
  constructor(private readonly runtime: OrcaRuntimeService) {
    this.dispatcher = new RpcDispatcher({ runtime, methods: WORKTREE_METHODS })
  }

  async list(): Promise<TelegramWorkspace[]> {
    const listing = await this.runtime.listManagedWorktrees(undefined, 10_000)
    return [
      ...listing.worktrees
        .filter((workspace) => !workspace.isArchived)
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.displayName || workspace.branch || workspace.path,
          activityAt: Math.max(
            workspace.lastActivityAt ?? 0,
            workspace.lastTerminalUseAt ?? 0,
            workspace.createdAt ?? 0
          )
        })),
      ...this.runtime
        .listFolderWorkspaces()
        .filter((workspace) => !workspace.isArchived)
        .map((workspace) => ({
          id: workspace.id,
          name: workspace.name,
          activityAt: Math.max(
            workspace.lastActivityAt,
            workspace.lastTerminalUseAt ?? 0,
            workspace.createdAt
          )
        }))
    ].sort(
      (left, right) =>
        right.activityAt - left.activityAt || left.name.localeCompare(right.name, 'ru')
    )
  }

  repositories(): TelegramWorkspace[] {
    return this.runtime
      .listVisibleRepos()
      .filter((repo) => repo.kind !== 'folder')
      .map((repo) => ({ id: repo.id, name: repo.displayName || repo.path }))
  }

  async create(repoId: string, name: string, operationId: string): Promise<string> {
    if (!this.repositories().some((repo) => repo.id === repoId)) {
      throw new Error('Репозиторий больше недоступен. Используй /new.')
    }
    const response = await this.dispatcher.dispatch({
      id: operationId,
      authToken: '',
      method: 'worktree.create',
      params: {
        repo: `id:${repoId}`,
        name,
        displayName: name,
        noParent: true,
        activate: false,
        clientMutationId: operationId,
        setupDecision: 'inherit'
      }
    })
    if (!response.ok) {
      throw new Error(response.error.message)
    }
    return CreatedWorktree.parse(response.result).worktree.id
  }
}
