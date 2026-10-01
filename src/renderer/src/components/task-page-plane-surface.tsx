import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw, Star } from 'lucide-react'
import type { PlaneProject, PlaneWorkItem } from '../../../shared/plane-types'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { PlaneConnectDialog } from '@/components/plane-connect-dialog'
import { TaskPagePlaneControls } from '@/components/task-page-plane-controls'
import { TaskPagePlaneWorkItemList } from '@/components/task-page-plane-work-item-list'
import {
  loadPlaneDefaultProjectId,
  resolvePlaneProjectId,
  savePlaneDefaultProjectId
} from '@/components/plane-default-project-storage'
import {
  planeWorkItemOrderBy,
  selectPlaneWorkItems,
  type PlaneWorkItemView
} from '@/components/plane-work-item-view'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { usePlaneConnection } from '@/hooks/usePlaneConnection'
import { translate } from '@/i18n/i18n'
import { planeListProjects, planeListWorkItems } from '@/runtime/runtime-plane-client'
import { useAppStore } from '@/store'

const MAX_LOADED_ITEMS = 2000

export function TaskPagePlaneSurface({
  onHide,
  onStartWorkspace
}: {
  onHide: () => void
  onStartWorkspace: (item: PlaneWorkItem) => void
}): React.JSX.Element {
  const { status, checking, error: statusError, refresh } = usePlaneConnection()
  const [connectOpen, setConnectOpen] = useState(false)

  if (checking) {
    return (
      <div className="flex justify-center py-14">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!status.connected) {
    return (
      <>
        <div className="mt-4 flex flex-col items-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
          <PlaneIcon className="mb-4 size-8 text-muted-foreground/60" />
          <p className="text-base font-medium">
            {translate(
              'auto.components.TaskPagePlaneSurface.connectTitle',
              'Connect your Plane workspace'
            )}
          </p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            {statusError ??
              translate(
                'auto.components.TaskPagePlaneSurface.connectDescription',
                'Browse and start work from Plane work items directly from here.'
              )}
          </p>
          <div className="mt-5 flex gap-2">
            <Button onClick={() => setConnectOpen(true)}>
              {translate('auto.components.TaskPagePlaneSurface.connect', 'Connect Plane')}
            </Button>
            <Button variant="outline" onClick={onHide}>
              {translate('auto.components.TaskPagePlaneSurface.hide', 'Hide Plane')}
            </Button>
          </div>
        </div>
        <PlaneConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          onConnected={() => void refresh()}
        />
      </>
    )
  }

  // Why: keyed by the active workspace so projects and work items from a
  // previous connection are dropped with the component rather than lingering
  // until the next fetch lands.
  return (
    <PlaneWorkspaceWorkItems
      key={status.activeWorkspaceId ?? 'active'}
      workspaceId={status.activeWorkspaceId ?? 'active'}
      onStartWorkspace={onStartWorkspace}
    />
  )
}

function PlaneWorkspaceWorkItems({
  workspaceId,
  onStartWorkspace
}: {
  workspaceId: string
  onStartWorkspace: (item: PlaneWorkItem) => void
}): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const [projects, setProjects] = useState<PlaneProject[]>([])
  const [projectId, setProjectId] = useState('')
  const [defaultProjectId, setDefaultProjectId] = useState(() =>
    loadPlaneDefaultProjectId(workspaceId)
  )
  const [items, setItems] = useState<PlaneWorkItem[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [limit, setLimit] = useState(250)
  const [view, setView] = useState<PlaneWorkItemView>({
    search: '',
    stateId: 'all',
    assigneeId: 'all',
    priority: 'all',
    sortField: 'updated',
    sortDirection: 'desc'
  })
  const project = projects.find((entry) => entry.id === projectId)
  const orderBy = planeWorkItemOrderBy(view)
  const visibleItems = useMemo(() => selectPlaneWorkItems(items, view), [items, view])

  useEffect(() => {
    // Why: a superseded response must not write state. Every other provider
    // effect in TaskPage guards the same way.
    let cancelled = false
    void planeListProjects(settings, {})
      .then((next) => {
        if (cancelled) {
          return
        }
        setProjects(next)
        setProjectId((current) => resolvePlaneProjectId(next, current, workspaceId))
      })
      .catch((cause) => {
        if (cancelled) {
          return
        }
        setError(
          cause instanceof Error
            ? cause.message
            : translate(
                'auto.components.TaskPagePlaneSurface.projectsError',
                'Unable to load projects'
              )
        )
      })
    return () => {
      cancelled = true
    }
  }, [settings, workspaceId])

  useEffect(() => {
    if (!project) {
      return
    }
    // Why: switching project mid-flight would otherwise let the previous
    // project's rows land under the new selection.
    let cancelled = false
    setLoading(true)
    setError(null)
    void planeListWorkItems(settings, { project, limit, orderBy })
      .then((result) => {
        if (!cancelled) {
          setItems(result.items)
          setTruncated(result.truncated)
        }
      })
      .catch((cause) => {
        if (cancelled) {
          return
        }
        setError(
          cause instanceof Error
            ? cause.message
            : translate(
                'auto.components.TaskPagePlaneSurface.workItemsError',
                'Unable to load work items'
              )
        )
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [project, refreshNonce, settings, limit, orderBy])

  const changeProject = (nextProjectId: string): void => {
    setItems([])
    setTruncated(false)
    setLimit(250)
    setProjectId(nextProjectId)
  }

  const changeView = (next: PlaneWorkItemView): void => {
    if (planeWorkItemOrderBy(next) !== orderBy) {
      setItems([])
      setTruncated(false)
      setLimit(250)
    }
    setView(next)
  }

  const toggleDefaultProject = (): void => {
    if (!project) {
      return
    }
    const next = defaultProjectId === project.id ? null : project.id
    savePlaneDefaultProjectId(workspaceId, next)
    setDefaultProjectId(next)
  }

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Select value={project?.id ?? ''} onValueChange={changeProject}>
            <SelectTrigger className="h-8 w-56 max-w-full">
              <SelectValue
                placeholder={translate(
                  'auto.components.TaskPagePlaneSurface.project',
                  'Select project'
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {projects.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.identifier} · {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-pressed={Boolean(project && defaultProjectId === project.id)}
            onClick={toggleDefaultProject}
            disabled={!project}
          >
            <Star className={project && defaultProjectId === project.id ? 'fill-current' : ''} />
            {project && defaultProjectId === project.id
              ? translate('auto.components.TaskPagePlaneSurface.defaultProject', 'Default project')
              : translate('auto.components.TaskPagePlaneSurface.setDefault', 'Set default')}
          </Button>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {visibleItems.length} / {items.length}{' '}
            {translate('auto.components.TaskPagePlaneSurface.shown', 'loaded')}
            {truncated
              ? ` · ${translate('auto.components.TaskPagePlaneSurface.moreAvailable', 'more available')}`
              : ''}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setRefreshNonce((value) => value + 1)}
            aria-label={translate(
              'auto.components.TaskPagePlaneSurface.refresh',
              'Refresh Plane work items'
            )}
          >
            <RefreshCw />
          </Button>
        </div>
      </div>
      <TaskPagePlaneControls items={items} view={view} onViewChange={changeView} />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        {error ? (
          <p className="border-b border-border p-4 text-sm text-destructive">{error}</p>
        ) : null}
        {loading && items.length === 0 ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        ) : visibleItems.length ? (
          <TaskPagePlaneWorkItemList items={visibleItems} onStartWorkspace={onStartWorkspace} />
        ) : !error ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {items.length
              ? translate(
                  'auto.components.TaskPagePlaneSurface.noMatches',
                  'No loaded work items match these filters.'
                )
              : translate(
                  'auto.components.TaskPagePlaneSurface.empty',
                  'No work items found in this project.'
                )}
          </p>
        ) : null}
        {truncated ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/50 px-3 py-2 text-xs text-muted-foreground">
            <span>
              {limit >= MAX_LOADED_ITEMS
                ? translate(
                    'auto.components.TaskPagePlaneSurface.loadLimit',
                    'Showing the first 2,000 work items. Narrow the list in Plane to see more.'
                  )
                : translate(
                    'auto.components.TaskPagePlaneSurface.loadedOnly',
                    'Filters and sorting apply to loaded work items.'
                  )}
            </span>
            {limit < MAX_LOADED_ITEMS ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={loading}
                onClick={() => setLimit((current) => Math.min(current + 250, MAX_LOADED_ITEMS))}
              >
                {loading
                  ? translate('auto.components.TaskPagePlaneSurface.loadingMore', 'Loading…')
                  : translate('auto.components.TaskPagePlaneSurface.loadMore', 'Load 250 more')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
