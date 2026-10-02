// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import { buildMonitorRows } from './work-monitor-model'
import { WorkMonitorTeam } from './WorkMonitorTeam'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, text: string, values?: Record<string, number>) =>
    text.replace(/{{(\w+)}}/g, (_match, key: string) => String(values?.[key] ?? ''))
}))
vi.mock('@/i18n/relative-time-format', () => ({
  formatUiRelativeTimeFromDate: () => 'this minute'
}))
const task = {
  id: 'task',
  key: 'DEV-42',
  sequenceId: 42,
  title: 'Reconnect',
  url: 'https://plane.example/DEV-42',
  project: { id: 'project', identifier: 'DEV', name: 'Development' },
  state: { id: 'started', name: 'In progress', group: 'started' as const },
  assignees: [],
  labels: [],
  priority: 'none' as const,
  createdAt: '',
  updatedAt: ''
}
const pr: GitHubWorkItem = {
  id: 'pr',
  number: 12,
  repoId: 'repo',
  type: 'pr',
  title: 'DEV-42 Reconnect',
  state: 'open',
  url: 'https://github.com/acme/orca/pull/12',
  author: 'alice',
  labels: [],
  updatedAt: ''
}
afterEach(cleanup)

describe('monitor team counting units', () => {
  it('counts distinct requested PRs while keeping author actions task-based', () => {
    const requests = [
      { login: 'bob', name: null, avatarUrl: '' },
      { login: 'bob', name: null, avatarUrl: '' }
    ]
    const prs = [
      pr,
      { ...pr, id: 'second', number: 13, url: 'https://github.com/acme/orca/pull/13' }
    ].map((item) => ({
      ...item,
      reviewRequests: requests,
      reviewDecision: 'CHANGES_REQUESTED' as const,
      mergeable: 'CONFLICTING' as const
    }))
    const rows = buildMonitorRows(prs, [task])
    expect(rows).toHaveLength(1)
    render(<WorkMonitorTeam rows={rows} onSelect={vi.fn()} />)
    const bob = screen.getByRole('button', { name: 'bob' }).closest('tr')
    const alice = screen.getByRole('button', { name: 'alice' }).closest('tr')
    if (!bob || !alice) {
      throw new Error('Missing team rows')
    }
    expect(within(bob).getAllByRole('cell')[3]).toHaveTextContent('2')
    expect(within(alice).getAllByRole('cell')[4]).toHaveTextContent('1')
  })

  it('counts distinct PRs with unknown review routing within one task', () => {
    const rows = buildMonitorRows(
      [
        { ...pr, reviewRequests: [] },
        {
          ...pr,
          id: 'second',
          number: 13,
          url: 'https://github.com/acme/orca/pull/13',
          reviewRequests: []
        }
      ],
      [task]
    )
    render(<WorkMonitorTeam rows={rows} onSelect={vi.fn()} />)
    expect(
      screen.getByText('2 PRs with unconfirmed review routing · 0 tasks need author actions')
    ).toBeVisible()
    expect(screen.queryByText(/without a pending review request/)).not.toBeInTheDocument()
  })
})
