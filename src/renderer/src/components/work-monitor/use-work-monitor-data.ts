import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Repo } from '../../../../shared/repo-types'
import type { PlaneConnectionStatus } from '../../../../shared/plane-types'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { useAppStore } from '@/store'
import { buildSelectedReposKey } from '../task-page-work-item-pagination'
import { getTaskPageRepoSourceContext } from '../task-page-source-context'
import { loadMonitorSnapshot, type MonitorSnapshot } from './work-monitor-load'

export function useWorkMonitorData(
  repos: readonly Repo[],
  status: PlaneConnectionStatus,
  projectId: string,
  checking: boolean
) {
  const activeRuntimeEnvironmentId = useAppStore((s) => s.settings?.activeRuntimeEnvironmentId)
  const settings = useMemo(() => ({ activeRuntimeEnvironmentId }), [activeRuntimeEnvironmentId])
  const repoKey = buildSelectedReposKey(repos, (r) => getTaskPageRepoSourceContext(r, 'github'))
  const context = `${repoKey}::${activeRuntimeEnvironmentId ?? 'local'}::${status.selectedWorkspaceId ?? status.activeWorkspaceId ?? ''}::${status.connected}::${projectId}`
  const identityContext = `${repoKey}::${activeRuntimeEnvironmentId ?? 'local'}`
  const [result, setResult] = useState<{ context: string; data: MonitorSnapshot } | null>(null)
  const [loadingContext, setLoadingContext] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), [])
  const [githubLogin, setGitHubLogin] = useState('')

  useEffect(() => {
    let cancelled = false
    setGitHubLogin('')
    const saved = readLogin(identityContext)
    if (saved) {
      setGitHubLogin(saved)
    } else if (
      !activeRuntimeEnvironmentId &&
      repos.every((r) => getRepoExecutionHostId(r) === LOCAL_EXECUTION_HOST_ID)
    ) {
      void window.api.gh
        .viewer()
        .then((viewer) => {
          if (!cancelled) {
            setGitHubLogin((current) => current || viewer?.login || '')
          }
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [identityContext, activeRuntimeEnvironmentId, repos])

  useEffect(() => {
    if (checking) {
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setLoadingContext(context)
    void loadMonitorSnapshot(repos, settings, status, projectId, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setResult({ context, data })
          setLoadingContext(null)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setResult({
            context,
            data: {
              github: [],
              plane: [],
              projects: [],
              errors: [cause instanceof Error ? cause.message : String(cause)],
              limited: false,
              fetchedAt: ''
            }
          })
          setLoadingContext(null)
        }
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [context, settings, refreshNonce, checking, repos, status, projectId])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }, 300_000)
    const unsubscribe = window.api.gh.onWorkItemMutated(refresh)
    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [refresh])

  const changeLogin = (login: string): void => {
    setGitHubLogin(login.trim())
    try {
      localStorage.setItem(`orca.work-monitor.login.${identityContext}`, login.trim())
    } catch {
      /* Selection remains usable without storage. */
    }
  }
  return {
    data: result?.context === context ? result.data : null,
    loading: checking || loadingContext === context || result?.context !== context,
    refresh,
    githubLogin,
    changeLogin
  }
}

function readLogin(context: string): string {
  try {
    return localStorage.getItem(`orca.work-monitor.login.${context}`) ?? ''
  } catch {
    return ''
  }
}
