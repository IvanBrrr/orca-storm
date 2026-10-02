// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import { useWorkMonitorAccounts } from './use-work-monitor-accounts'

const viewer = vi.fn()
const repo: Repo = {
  id: 'one',
  path: '/one',
  displayName: 'Orca',
  badgeColor: '',
  addedAt: 0,
  connectionId: 'ssh-one',
  upstream: { owner: 'acme', repo: 'orca' }
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  viewer.mockResolvedValue({ login: 'alice' })
  Object.defineProperty(window, 'api', { configurable: true, value: { gh: { viewer } } })
})
afterEach(cleanup)

describe('monitor account identities', () => {
  it('keeps an explicitly selected SSH login when repositories on the same source change', () => {
    const { result, rerender } = renderHook(({ repos }) => useWorkMonitorAccounts(repos), {
      initialProps: { repos: [repo] }
    })
    act(() => result.current.changeLogin(result.current.scopes[0].key, 'alice'))
    rerender({
      repos: [
        repo,
        { ...repo, id: 'two', path: '/two', upstream: { owner: 'acme', repo: 'other' } }
      ]
    })
    expect(result.current.githubAccounts.two.login).toBe('alice')
    rerender({ repos: [{ ...repo, id: 'two', path: '/two' }] })
    expect(result.current.githubAccounts.two.login).toBe('alice')
    expect(viewer).not.toHaveBeenCalled()
  })

  it('auto-detects only the local public account and permits a separate Enterprise login', async () => {
    const local = { ...repo, connectionId: undefined }
    const enterprise = {
      ...local,
      id: 'enterprise',
      upstream: { owner: 'acme', repo: 'orca', host: 'github.example' }
    }
    const { result } = renderHook(() => useWorkMonitorAccounts([local, enterprise]))
    await waitFor(() => expect(result.current.githubAccounts.one.login).toBe('alice'))
    expect(result.current.githubAccounts.enterprise.login).toBe('')
    const scope = result.current.scopes.find((account) => account.host === 'github.example')
    if (!scope) {
      throw new Error('Missing Enterprise scope')
    }
    act(() => result.current.changeLogin(scope.key, 'bob'))
    expect(result.current.githubAccounts.enterprise.login).toBe('bob')
    expect(result.current.githubAccounts.one.login).toBe('alice')
  })

  it('does not migrate old repository-set login storage to new host identities', () => {
    localStorage.setItem('orca.work-monitor.login.legacy-repositories::local', 'alice')
    const { result } = renderHook(() => useWorkMonitorAccounts([repo]))
    expect(result.current.githubAccounts.one.login).toBe('')
  })

  it('rejects a late local viewer response after switching to SSH', async () => {
    let finish: (result: { login: string }) => void = () => {}
    viewer.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const localRepos: Repo[] = [{ ...repo, connectionId: undefined }]
    const { result, rerender } = renderHook(({ repos }) => useWorkMonitorAccounts(repos), {
      initialProps: { repos: localRepos }
    })
    rerender({ repos: [repo] })
    await act(async () => {
      finish({ login: 'alice' })
    })
    expect(result.current.githubAccounts.one.login).toBe('')
  })
})
