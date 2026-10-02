import { describe, expect, it } from 'vitest'
import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import type { PlaneWorkItem } from '../../../../shared/plane-types'
import { buildMonitorRows, monitorPeople, personalMonitorLane } from './work-monitor-model'

const identity = { githubLogin: 'alice', planeId: 'plane-alice' }
function pr(patch: Partial<GitHubWorkItem> = {}): GitHubWorkItem {
  return {
    id: 'pr-1',
    type: 'pr',
    number: 12,
    title: 'DEV-42 Fix reconnect',
    state: 'open',
    url: 'https://github.com/acme/orca/pull/12',
    labels: [],
    updatedAt: '2026-10-01T10:00:00Z',
    author: 'alice',
    repoId: 'repo-1',
    ...patch
  }
}
function task(patch: Partial<PlaneWorkItem> = {}): PlaneWorkItem {
  return {
    id: 'plane-task',
    key: 'DEV-42',
    sequenceId: 42,
    title: 'Reconnect',
    url: 'https://plane.example/acme/DEV-42',
    project: { id: 'project-1', identifier: 'DEV', name: 'Development' },
    state: { id: 'started', name: 'In progress', group: 'started' },
    assignees: [{ id: 'plane-alice', displayName: 'Alice' }],
    labels: [],
    priority: 'high',
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T09:00:00Z',
    ...patch
  }
}

describe('work monitor', () => {
  it('keeps author actions and a requested review on the same task', () => {
    const rows = buildMonitorRows(
      [
        pr({
          reviewDecision: 'CHANGES_REQUESTED',
          reviewRequests: [{ login: 'bob', name: null, avatarUrl: '' }],
          checksSummary: {
            state: 'failure',
            total: 1,
            failed: 1,
            passed: 0,
            pending: 0,
            neutral: 0
          }
        })
      ],
      [task()],
      identity
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].actions.map((a) => a.reason)).toEqual(['changes', 'checks', 'review'])
    expect(personalMonitorLane(rows[0], identity, 'author')).toBe(true)
    expect(personalMonitorLane(rows[0], { githubLogin: 'bob', planeId: null }, 'reviewer')).toBe(
      true
    )
    expect(personalMonitorLane(rows[0], identity, 'waiting')).toBe(false)
  })

  it('links several PRs to one task and does not close it while an open PR remains', () => {
    const rows = buildMonitorRows(
      [
        pr({ state: 'merged' }),
        pr({
          number: 13,
          url: 'https://github.com/acme/orca/pull/13',
          reviewRequests: [{ login: 'bob', name: null, avatarUrl: '' }]
        })
      ],
      [task()],
      identity
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].prs).toHaveLength(2)
    expect(rows[0].actions.some((a) => a.reason === 'close')).toBe(false)
    expect(personalMonitorLane(rows[0], identity, 'waiting')).toBe(true)
  })

  it('assigns the completion check to the Plane assignee after all PRs merged', () => {
    const [row] = buildMonitorRows([pr({ state: 'merged', author: 'bob' })], [task()], identity)
    expect(row.actions).toEqual([
      { lane: 'finish', reason: 'close', person: { id: 'github:alice', name: 'alice' } }
    ])
    expect(personalMonitorLane(row, identity, 'finish')).toBe(true)
  })

  it('does not offer completion for a completed task or an unrelated merged PR', () => {
    expect(
      buildMonitorRows(
        [pr({ state: 'merged' })],
        [task({ state: { id: 'done', name: 'Done', group: 'completed' } })],
        identity
      )
    ).toEqual([])
    expect(buildMonitorRows([pr({ state: 'merged', title: 'Unrelated' })], [], identity)).toEqual(
      []
    )
  })

  it('does not conflate matching keys in different Plane workspaces', () => {
    const rows = buildMonitorRows(
      [pr()],
      [
        task(),
        task({ id: 'other', url: 'https://plane.example/other/DEV-42', workspaceId: 'other' })
      ],
      identity
    )
    expect(rows).toHaveLength(3)
    expect(rows.find((r) => r.prs.length)?.plane).toBeNull()
  })

  it('matches complete keys in a branch without matching key prefixes', () => {
    const [row] = buildMonitorRows(
      [pr({ title: 'Reconnect', branchName: 'fix/dev-42-reconnect' })],
      [task()],
      identity
    )
    expect(row.plane?.key).toBe('DEV-42')
    expect(buildMonitorRows([pr({ title: 'DEV-420 Reconnect' })], [task()], identity)).toHaveLength(
      2
    )
  })

  it('deduplicates a PR returned through multiple repositories', () => {
    expect(buildMonitorRows([pr(), pr({ repoId: 'repo-2' })], [], identity)).toHaveLength(1)
  })

  it('keeps the same login on GitHub and an Enterprise host separate in the team overview', () => {
    const rows = buildMonitorRows(
      [
        pr({ author: 'bob' }),
        pr({
          author: 'bob',
          url: 'https://github.example/acme/orca/pull/12',
          prRepo: { owner: 'acme', repo: 'orca', host: 'github.example' }
        })
      ],
      [],
      identity
    )
    expect(
      monitorPeople(rows)
        .map((p) => p.id)
        .sort()
    ).toEqual(['github:bob', 'github:github.example:bob'])
  })

  it.each([
    { mergeable: 'UNKNOWN' as const, mergeStateStatus: 'UNKNOWN' },
    { mergeable: 'MERGEABLE' as const, mergeStateStatus: 'BLOCKED' },
    { mergeable: 'MERGEABLE' as const, mergeStateStatus: 'CLEAN', mergeQueueRequired: true }
  ])('does not treat approval alone as merge readiness: %j', (patch) => {
    const [row] = buildMonitorRows(
      [
        pr({
          reviewDecision: 'APPROVED',
          checksSummary: {
            state: 'success',
            total: 1,
            passed: 1,
            failed: 0,
            pending: 0,
            neutral: 0
          },
          ...patch
        })
      ],
      [],
      identity
    )
    expect(row.actions.some((a) => a.reason === 'merge')).toBe(false)
  })

  it('offers merge only with confirmed clean state and successful checks', () => {
    const [row] = buildMonitorRows(
      [
        pr({
          reviewDecision: 'APPROVED',
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          checksSummary: {
            state: 'success',
            total: 1,
            passed: 1,
            failed: 0,
            pending: 0,
            neutral: 0
          }
        })
      ],
      [],
      identity
    )
    expect(personalMonitorLane(row, identity, 'finish')).toBe(true)
  })

  it('keeps unknown review metadata distinct from a requested review', () => {
    const [row] = buildMonitorRows([pr()], [], identity)
    expect(row.actions[0].reason).toBe('unknown')
    expect(personalMonitorLane(row, identity, 'unknown')).toBe(true)
    expect(personalMonitorLane(row, identity, 'waiting')).toBe(false)
    expect(personalMonitorLane(row, identity, 'reviewer')).toBe(false)
  })

  it('keeps names from different providers separate and combines only the known viewer', () => {
    const rows = buildMonitorRows(
      [pr({ author: 'bob' })],
      [
        task({ assignees: [{ id: 'plane-bob', displayName: 'bob' }] }),
        task({ id: 'second', key: 'DEV-43', url: 'https://plane.example/acme/DEV-43' })
      ],
      identity
    )
    expect(
      monitorPeople(rows)
        .map((p) => p.id)
        .sort()
    ).toEqual(['github:alice', 'github:bob', 'plane:plane-bob'])
  })

  it('includes started Plane tasks for folder-only work without inventing a PR', () => {
    const [row] = buildMonitorRows([], [task()], identity)
    expect(row.prs).toEqual([])
    expect(personalMonitorLane(row, identity, 'working')).toBe(true)
    expect(
      buildMonitorRows(
        [],
        [task({ state: { id: 'backlog', name: 'Backlog', group: 'backlog' } })],
        identity
      )
    ).toEqual([])
  })
})
