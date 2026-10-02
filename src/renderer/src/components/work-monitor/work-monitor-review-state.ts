import type { Repo } from '../../../../shared/repo-types'
import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import { mapSettledWithConcurrency } from '../../../../shared/map-with-concurrency'
import {
  lookupGitHubWorkItemByOwnerRepoForSource,
  lookupGitHubWorkItemForSource
} from '@/lib/github-work-item-source-lookup'
import { getTaskPageRepoSourceContext } from '../task-page-source-context'

const DETAIL_LIMIT = 100

export async function loadMonitorReviewState(
  items: GitHubWorkItem[],
  repos: readonly Repo[],
  signal?: AbortSignal,
  onItem?: (item: GitHubWorkItem) => void
): Promise<{ items: GitHubWorkItem[]; failed: number; limited: boolean }> {
  const unique = [...new Map(items.map((pr) => [pr.url, pr])).values()]
  const candidates = unique
    .filter((pr) => pr.state === 'open')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const results = await mapSettledWithConcurrency(
    candidates.slice(0, DETAIL_LIMIT),
    3,
    async (pr) => {
      if (signal?.aborted) {
        return null
      }
      const repo = repos.find((r) => r.id === pr.repoId)
      if (!repo) {
        throw new Error('Repository no longer available')
      }
      const args = {
        repoPath: repo.path,
        repoId: repo.id,
        sourceContext: getTaskPageRepoSourceContext(repo, 'github'),
        number: pr.number,
        type: 'pr' as const
      }
      const detail = pr.prRepo
        ? await lookupGitHubWorkItemByOwnerRepoForSource({ ...args, ...pr.prRepo })
        : await lookupGitHubWorkItemForSource(args)
      if (!detail || detail.url !== pr.url) {
        throw new Error('Pull request state could not be confirmed')
      }
      if (!signal?.aborted) {
        onItem?.(detail)
      }
      return detail
    }
  )
  const byUrl = new Map(
    results.flatMap((result) =>
      result.status === 'fulfilled' && result.value
        ? [[result.value.url, result.value] as const]
        : []
    )
  )
  return {
    items: unique.map((pr) => byUrl.get(pr.url) ?? pr),
    failed: results.filter((r) => r.status === 'rejected').length,
    limited: candidates.length > DETAIL_LIMIT
  }
}
