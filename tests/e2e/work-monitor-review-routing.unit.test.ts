import { describe, expect, it } from 'vitest'
import { mapPullRequestWorkItem } from '../../src/main/github/client/map/work-item'
import {
  buildMonitorRows,
  personalMonitorLane
} from '../../src/renderer/src/components/work-monitor/work-monitor-model'

describe('monitor review request projection', () => {
  it('does not claim a pending team review is absent when the mapper drops its team entry', () => {
    const mapped = mapPullRequestWorkItem({
      number: 12,
      title: 'Reconnect',
      state: 'OPEN',
      url: 'https://github.com/acme/orca/pull/12',
      author: { login: 'alice' },
      reviewDecision: 'REVIEW_REQUIRED',
      reviewRequests: [{ name: 'Frontend', slug: 'frontend' }]
    })
    expect(mapped.reviewRequests).toEqual([])
    const [row] = buildMonitorRows([{ ...mapped, repoId: 'repo' }], [])
    expect(row.actions).toEqual([
      {
        lane: 'unknown',
        reason: 'reviewRoutingUnknown',
        person: { id: 'github:alice', name: 'alice' },
        prUrl: mapped.url
      }
    ])
  })

  it('keeps user review requests actionable without inferring team membership', () => {
    const mapped = mapPullRequestWorkItem({
      number: 12,
      title: 'Reconnect',
      state: 'OPEN',
      url: 'https://github.com/acme/orca/pull/12',
      author: { login: 'alice' },
      reviewRequests: [{ login: 'bob' }, { name: 'Frontend', slug: 'frontend' }]
    })
    const [row] = buildMonitorRows([{ ...mapped, repoId: 'repo' }], [])
    expect(
      personalMonitorLane(
        row,
        { githubAccounts: { repo: { host: 'github.com', login: 'bob' } }, planeViewerIds: {} },
        'reviewer'
      )
    ).toBe(true)
    expect(row.participants.map((person) => person.id)).toEqual(['github:alice', 'github:bob'])
  })
})
