import { useEffect, useMemo, useState } from 'react'
import type { Repo } from '../../../../shared/repo-types'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { monitorAccountScopes } from './work-monitor-account-scopes'
import type { MonitorIdentity } from './work-monitor-model'

export function useWorkMonitorAccounts(repos: readonly Repo[]) {
  const scopes = useMemo(() => monitorAccountScopes(repos), [repos])
  const [logins, setLogins] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    setLogins((current) => {
      const next = Object.fromEntries(
        scopes.map((scope) => [scope.key, readLogin(scope.key) || current[scope.key] || ''])
      )
      return Object.keys(current).length === scopes.length &&
        scopes.every((scope) => current[scope.key] === next[scope.key])
        ? current
        : next
    })
    const localPublic = scopes.find(
      (scope) => scope.executionHostId === LOCAL_EXECUTION_HOST_ID && scope.host === 'github.com'
    )
    if (localPublic && !readLogin(localPublic.key)) {
      void window.api.gh
        .viewer()
        .then((viewer) => {
          if (!cancelled && viewer?.login) {
            setLogins((current) =>
              current[localPublic.key]
                ? current
                : {
                    ...current,
                    [localPublic.key]: current[localPublic.key] || viewer.login
                  }
            )
          }
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [scopes])
  const githubAccounts: MonitorIdentity['githubAccounts'] = Object.fromEntries(
    scopes.flatMap((scope) =>
      scope.repoIds.map((id) => [id, { host: scope.host, login: logins[scope.key] ?? '' }])
    )
  )
  const changeLogin = (scopeKey: string, value: string): void => {
    const login = value.trim()
    setLogins((current) => ({ ...current, [scopeKey]: login }))
    try {
      localStorage.setItem(storageKey(scopeKey), login)
    } catch {
      /* Selection remains usable without storage. */
    }
  }
  return { scopes, logins, githubAccounts, changeLogin }
}

function storageKey(scopeKey: string): string {
  return `orca.work-monitor.account.v2.${scopeKey}`
}

function readLogin(scopeKey: string): string {
  try {
    return localStorage.getItem(storageKey(scopeKey)) ?? ''
  } catch {
    return ''
  }
}
