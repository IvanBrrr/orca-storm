import type { Repo } from '../../../../shared/repo-types'
import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import type {
  PlaneConnectionStatus,
  PlaneProject,
  PlaneWorkItem
} from '../../../../shared/plane-types'
import { mapSettledWithConcurrency } from '../../../../shared/map-with-concurrency'
import { getTaskPageRepoSourceContext } from '../task-page-source-context'
import {
  planeListProjects,
  planeListWorkItems,
  type RuntimePlaneSettings
} from '@/runtime/runtime-plane-client'
import { useAppStore } from '@/store'
import { loadMonitorReviewState } from './work-monitor-review-state'
import { translate } from '@/i18n/i18n'

export type MonitorSnapshot = {
  github: GitHubWorkItem[]
  plane: PlaneWorkItem[]
  projects: PlaneProject[]
  errors: string[]
  limited: boolean
  fetchedAt: string
}

export async function loadMonitorSnapshot(
  repos: readonly Repo[],
  settings: RuntimePlaneSettings,
  status: PlaneConnectionStatus,
  projectId: string,
  signal?: AbortSignal
): Promise<MonitorSnapshot> {
  const snapshot: MonitorSnapshot = {
    github: [],
    plane: [],
    projects: [],
    errors: [],
    limited: false,
    fetchedAt: ''
  }
  const repoArgs = repos.map((repo) => ({
    repoId: repo.id,
    path: repo.path,
    sourceContext: getTaskPageRepoSourceContext(repo, 'github')
  }))
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const githubQueries = repos.length ? ['is:pr is:open', `is:pr is:merged updated:>=${since}`] : []
  const results = await Promise.allSettled([
    ...githubQueries.map(async (query) => {
      const result = await useAppStore
        .getState()
        .fetchWorkItemsAcrossRepos(repoArgs, 100, repos.length * 100, query, {
          force: true,
          noCache: true,
          requireComplete: true,
          allowStaleFallback: false
        })
      snapshot.github.push(...result.items)
      if (result.failedCount || result.requestFailureCount) {
        snapshot.errors.push(
          `GitHub: ${result.requestFailureCount ?? result.failedCount} source(s) unavailable`
        )
      }
      if (result.items.length >= 100) {
        snapshot.limited = true
      }
    }),
    ...(status.connected
      ? [
          (async function loadPlane(): Promise<void> {
            const workspaceId = status.selectedWorkspaceId ?? status.activeWorkspaceId ?? undefined
            snapshot.projects = await planeListProjects(settings, { workspaceId })
            const projects =
              projectId === 'all'
                ? snapshot.projects
                : snapshot.projects.filter((p) => p.id === projectId)
            const responses = await mapSettledWithConcurrency(projects, 3, async (project) => {
              if (signal?.aborted) {
                return
              }
              const result = await planeListWorkItems(settings, {
                project,
                workspaceId: project.workspaceId ?? workspaceId,
                limit: 250,
                orderBy: '-updated_at'
              })
              snapshot.plane.push(...result.items)
              snapshot.limited ||= result.truncated
            })
            responses.forEach((result, index) => {
              if (result.status === 'rejected') {
                snapshot.errors.push(
                  `Plane · ${projects[index].name}: ${errorMessage(result.reason)}`
                )
              }
            })
          })()
        ]
      : [])
  ])
  results.forEach((result) => {
    if (result.status === 'rejected') {
      snapshot.errors.push(errorMessage(result.reason))
    }
  })
  const reviews = await loadMonitorReviewState(snapshot.github, repos, signal)
  snapshot.github = reviews.items
  snapshot.limited ||= reviews.limited
  if (reviews.failed) {
    snapshot.errors.push(
      translate(
        'workMonitor.stateErrors',
        'Detailed review or check states unavailable for {{count}} PRs. Their missing states remain unknown.',
        { count: reviews.failed }
      )
    )
  }
  snapshot.fetchedAt = new Date().toISOString()
  return snapshot
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
