// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { PlaneConnectionStatus } from '../../../../shared/plane-types'
import type { MonitorSnapshot } from './work-monitor-load'
import { useWorkMonitorData } from './use-work-monitor-data'

const { loadSnapshot } = vi.hoisted(() => ({ loadSnapshot: vi.fn() }))
vi.mock('./work-monitor-load', () => ({ loadMonitorSnapshot: loadSnapshot }))
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: { settings: null }) => unknown) => selector({ settings: null })
}))

const disconnected: PlaneConnectionStatus = { connected: false, viewer: null }
const first: Repo[] = [
  {
    id: 'first',
    path: '/same/path',
    displayName: 'First',
    badgeColor: '',
    addedAt: 0,
    connectionId: 'one',
    upstream: { owner: 'acme', repo: 'orca' }
  }
]
const second: Repo[] = [{ ...first[0], id: 'second', connectionId: 'two' }]
function snapshot(title: string): MonitorSnapshot {
  return {
    github: [
      {
        id: title,
        type: 'pr',
        number: 1,
        title,
        state: 'open',
        url: `https://github.com/acme/orca/pull/${title}`,
        labels: [],
        updatedAt: '',
        author: 'alice',
        repoId: title
      }
    ],
    plane: [],
    projects: [],
    errors: [],
    limited: false,
    fetchedAt: '2026-10-01T00:00:00Z',
    planeViewerIds: {}
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  vi.stubGlobal('api', undefined)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      gh: {
        viewer: vi.fn().mockResolvedValue({ login: 'local-user' }),
        onWorkItemMutated: vi.fn(() => vi.fn())
      }
    }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('work monitor request ownership', () => {
  it('rejects a late response from a previously selected SSH host', async () => {
    let resolveFirst: (value: MonitorSnapshot) => void = () => {}
    let resolveSecond: (value: MonitorSnapshot) => void = () => {}
    loadSnapshot
      .mockImplementationOnce(
        () =>
          new Promise<MonitorSnapshot>((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<MonitorSnapshot>((resolve) => {
            resolveSecond = resolve
          })
      )
    const { result, rerender } = renderHook(
      ({ repos }) => useWorkMonitorData(repos, disconnected, 'all', false),
      { initialProps: { repos: first } }
    )
    rerender({ repos: second })
    await act(async () => {
      resolveSecond(snapshot('second'))
    })
    expect(result.current.data?.github[0].title).toBe('second')
    await act(async () => {
      resolveFirst(snapshot('first'))
    })
    expect(result.current.data?.github[0].title).toBe('second')
    expect(result.current.loading).toBe(false)
  })

  it('hides the old snapshot immediately on a scope change', async () => {
    loadSnapshot
      .mockResolvedValueOnce(snapshot('first'))
      .mockImplementationOnce(() => new Promise(() => {}))
    const { result, rerender } = renderHook(
      ({ repos }) => useWorkMonitorData(repos, disconnected, 'all', false),
      { initialProps: { repos: first } }
    )
    await waitFor(() => expect(result.current.data?.github[0].title).toBe('first'))
    rerender({ repos: second })
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(true)
  })
})
