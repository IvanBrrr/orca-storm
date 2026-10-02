// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorRow } from './work-monitor-model'
import { WorkMonitorActivity } from './WorkMonitorActivity'

const { fetchComments, repos } = vi.hoisted(() => ({
  fetchComments: vi.fn(),
  repos: [
    {
      id: 'repo',
      path: '/repo',
      displayName: 'Orca',
      badgeColor: '',
      addedAt: 0,
      upstream: { owner: 'acme', repo: 'orca' }
    }
  ]
}))
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: { repos: typeof repos }) => unknown) => selector({ repos }),
    { getState: () => ({ fetchPRComments: fetchComments }) }
  )
}))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, text: string, values?: { count: number }) =>
    text.replace('{{count}}', String(values?.count ?? ''))
}))
vi.mock('@/i18n/relative-time-format', () => ({ formatUiRelativeTimeFromDate: () => 'last week' }))
const row: MonitorRow = {
  id: 'row',
  title: 'Reconnect',
  plane: null,
  actions: [],
  participants: [],
  updatedAt: '',
  prs: [
    {
      id: 'pr',
      type: 'pr',
      repoId: 'repo',
      number: 12,
      title: 'Reconnect',
      state: 'open',
      url: 'https://github.com/acme/orca/pull/12',
      author: 'alice',
      labels: [],
      updatedAt: ''
    }
  ]
}
beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('monitor comment coverage', () => {
  it('does not claim there are no unresolved threads when a tolerant read returns an empty fallback', async () => {
    fetchComments.mockResolvedValue([])
    render(<WorkMonitorActivity row={row} />)
    expect(await screen.findByText(/0 unresolved threads found.*total is unknown/)).toBeVisible()
    expect(
      screen.queryByText('0 unresolved review threads in loaded comments')
    ).not.toBeInTheDocument()
  })

  it('labels cached or partial comments as available data rather than a current complete read', async () => {
    fetchComments.mockResolvedValue([
      {
        id: 1,
        author: 'bob',
        body: 'Cached review',
        createdAt: '2026-09-20',
        threadId: 'thread',
        isResolved: false
      }
    ])
    render(<WorkMonitorActivity row={row} />)
    expect(await screen.findByText(/1 unresolved threads found.*cached or partial/)).toBeVisible()
    expect(screen.getByText('Cached review')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Available PR comments' })).toBeVisible()
  })

  it('also reports an explicit rejected read', async () => {
    fetchComments.mockRejectedValue(new Error('Host unavailable'))
    render(<WorkMonitorActivity row={row} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Some PR comments could not be loaded.'
    )
    expect(screen.getByText(/total is unknown/)).toBeVisible()
  })
})
