import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Repo } from '../../../../shared/repo-types'
import type { PlaneConnectionStatus } from '../../../../shared/plane-types'
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
  const [result, setResult] = useState<{ context: string; data: MonitorSnapshot } | null>(null)
  const [loadingContext, setLoadingContext] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), [])
  useEffect(() => {
    if (checking) {
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setLoadingContext(context)
    void loadMonitorSnapshot(repos, settings, status, projectId, controller.signal, (data) => {
      if (!cancelled) {
        setResult({ context, data })
      }
    })
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
              fetchedAt: '',
              planeViewerIds: {}
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
      if (document.visibilityState === 'visible' && useAppStore.getState().activeView === 'tasks') {
        refresh()
      }
    }, 300_000)
    const unsubscribe = window.api.gh.onWorkItemMutated(refresh)
    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [refresh])

  return {
    data: result?.context === context ? result.data : null,
    loading: checking || loadingContext === context || result?.context !== context,
    refresh
  }
}
