import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import { buildMonitorRows } from './work-monitor-model'
import { loadMonitorReviewState } from './work-monitor-review-state'

const { lookup, lookupByRepo } = vi.hoisted(() => ({ lookup: vi.fn(), lookupByRepo: vi.fn() }))
vi.mock('@/lib/github-work-item-source-lookup', () => ({
  lookupGitHubWorkItemForSource: lookup,
  lookupGitHubWorkItemByOwnerRepoForSource: lookupByRepo
}))
const repo: Repo = {
  id: 'ssh',
  path: '/same/path',
  connectionId: 'host-two',
  upstream: { owner: 'acme', repo: 'orca' },
  displayName: 'Orca',
  badgeColor: '',
  addedAt: 0
}
const pr: GitHubWorkItem = {
  id: 'pr',
  type: 'pr',
  number: 1,
  title: 'Reconnect',
  state: 'open',
  url: 'https://github.example/acme/orca/pull/1',
  labels: [],
  updatedAt: '2026-10-01',
  author: 'alice',
  repoId: repo.id,
  prRepo: { owner: 'acme', repo: 'orca', host: 'github.example' }
}
beforeEach(() => vi.clearAllMocks())

describe('monitor detailed PR states', () => {
  it('hydrates author attention from a list payload that has no review decision', async () => {
    lookupByRepo.mockResolvedValue({
      ...pr,
      reviewDecision: 'CHANGES_REQUESTED',
      mergeable: 'CONFLICTING'
    })
    const result = await loadMonitorReviewState([pr], [repo])
    const [row] = buildMonitorRows(result.items, [], { githubLogin: 'alice', planeId: null })
    expect(row.actions.map((a) => a.reason)).toEqual(['changes', 'conflict'])
    expect(lookupByRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: '/same/path',
        repoId: 'ssh',
        sourceContext: expect.objectContaining({ hostId: 'ssh:host-two' }),
        owner: 'acme',
        repo: 'orca',
        host: 'github.example',
        type: 'pr',
        number: 1
      })
    )
  })

  it('preserves unknown states on failure and refuses a mismatched PR URL', async () => {
    lookupByRepo.mockResolvedValue({
      ...pr,
      url: 'https://github.com/other/repo/pull/1',
      reviewDecision: 'APPROVED'
    })
    const result = await loadMonitorReviewState([pr], [repo])
    expect(result.failed).toBe(1)
    expect(result.items).toEqual([pr])
    expect(result.items[0].reviewDecision).toBeUndefined()
  })

  it('caps detailed reads at 100 and keeps concurrency at three', async () => {
    let active = 0
    let peak = 0
    lookupByRepo.mockImplementation(async ({ number }: { number: number }) => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return { ...pr, number, url: `https://github.example/acme/orca/pull/${number}` }
    })
    const items = Array.from({ length: 101 }, (_, i) => ({
      ...pr,
      number: i + 1,
      url: `https://github.example/acme/orca/pull/${i + 1}`
    }))
    const result = await loadMonitorReviewState(items, [repo])
    expect(lookupByRepo).toHaveBeenCalledTimes(100)
    expect(peak).toBe(3)
    expect(result.limited).toBe(true)
    expect(result.items).toHaveLength(101)
  })

  it('does not enqueue reads after the owning scope is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await loadMonitorReviewState([pr], [repo], controller.signal)
    expect(lookupByRepo).not.toHaveBeenCalled()
    expect(result.items).toEqual([pr])
  })
})
