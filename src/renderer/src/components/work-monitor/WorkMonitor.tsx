import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import RepoMultiCombobox from '@/components/ui/repo-multi-combobox'
import { PlaneConnectDialog } from '@/components/plane-connect-dialog'
import { usePlaneConnection } from '@/hooks/usePlaneConnection'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { useAppStore } from '@/store'
import {
  getProjectProviderIdentity,
  isProjectRemoteIdentityPending
} from '../../../../shared/project-host-setup-projection'
import {
  getTaskEligibleRepos,
  getDefaultTaskRepoSelection,
  getTaskProjectPickerGroups,
  normalizeTaskRepoSelection
} from '../task-page-default-repo-selection'
import { useWorkMonitorData } from './use-work-monitor-data'
import {
  buildMonitorRows,
  personalMonitorLane,
  type MonitorLane,
  type MonitorRow
} from './work-monitor-model'
import { monitorLaneLabel } from './work-monitor-copy'
import { WorkMonitorRows } from './WorkMonitorRows'
import { WorkMonitorTeam } from './WorkMonitorTeam'
import { WorkMonitorDetail } from './WorkMonitorDetail'

const LANES: MonitorLane[] = ['author', 'reviewer', 'waiting', 'working', 'finish', 'unknown']

export function WorkMonitor({ view }: { view: 'attention' | 'team' }): React.JSX.Element {
  useTranslation()
  const repos = useAppStore((s) => s.repos)
  const eligible = useMemo(
    () =>
      getTaskEligibleRepos(repos).filter(
        (r) => getProjectProviderIdentity(r) !== null || isProjectRemoteIdentityPending(r)
      ),
    [repos]
  )
  const [selection, setSelection] = useState<ReadonlySet<string> | null>(null)
  const selected = useMemo(
    () =>
      selection
        ? normalizeTaskRepoSelection(eligible, selection)
        : getDefaultTaskRepoSelection(eligible),
    [eligible, selection]
  )
  const pickerRepos = useMemo(
    () => getTaskProjectPickerGroups(eligible, selected).map((g) => g.repo),
    [eligible, selected]
  )
  const selectedRepos = useMemo(
    () => eligible.filter((r) => selected.has(r.id)),
    [eligible, selected]
  )
  const { status, checking, error, refresh: refreshConnection } = usePlaneConnection()
  const runtimeId = useAppStore((s) => s.settings?.activeRuntimeEnvironmentId)
  const workspaceScope = `${runtimeId ?? 'local'}::${status.selectedWorkspaceId ?? status.activeWorkspaceId ?? ''}`
  const [projectSelection, setProjectSelection] = useState({ scope: '', id: 'all' })
  const projectId = projectSelection.scope === workspaceScope ? projectSelection.id : 'all'
  const { data, loading, refresh, githubLogin, changeLogin } = useWorkMonitorData(
    selectedRepos,
    status,
    projectId,
    checking
  )
  const [connectOpen, setConnectOpen] = useState(false)
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null)
  const identity = useMemo(
    () => ({ githubLogin, planeId: status.viewer?.id ?? null }),
    [githubLogin, status.viewer?.id]
  )
  const rows = useMemo(
    () => buildMonitorRows(data?.github ?? [], data?.plane ?? [], identity),
    [data, identity]
  )
  const selectedRow = rows.find((row) => row.id === selectedRowId) ?? null
  const projects = data?.projects ?? []
  const errors = [...new Set([...(error ? [error] : []), ...(data?.errors ?? [])])]
  const selectRow = (row: MonitorRow): void => setSelectedRowId(row.id)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-5 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label>{translate('workMonitor.repositories', 'GitHub repositories')}</Label>
            <RepoMultiCombobox
              repos={pickerRepos}
              selected={selected}
              onChange={setSelection}
              onSelectAll={() => setSelection(null)}
            />
          </div>
          {status.connected ? (
            <div className="space-y-2">
              <Label htmlFor="work-monitor-project">
                {translate('workMonitor.planeProjects', 'Plane projects')}
              </Label>
              <Select
                value={projectId}
                onValueChange={(id) => setProjectSelection({ scope: workspaceScope, id })}
              >
                <SelectTrigger id="work-monitor-project">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {translate('workMonitor.allProjects', 'All connected projects')}
                  </SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.workspaceName ? `${project.workspaceName} / ` : ''}
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConnectOpen(true)}>
              {translate('workMonitor.connectPlane', 'Connect Plane')}
            </Button>
          )}
          <div className="space-y-2">
            <Label htmlFor="work-monitor-login">
              {translate('workMonitor.myLogin', 'My GitHub login')}
            </Label>
            <Input
              id="work-monitor-login"
              value={githubLogin}
              onChange={(event) => changeLogin(event.target.value)}
              placeholder="octocat"
              autoComplete="off"
            />
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => {
            refresh()
            void refreshConnection()
          }}
        >
          <RefreshCw />
          {translate('workMonitor.refresh', 'Refresh')}
        </Button>
      </div>
      <div
        className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <span>
          {translate(
            'workMonitor.scope',
            '{{count}} loaded tasks · open PRs and merged PRs from the last 30 days',
            { count: rows.length }
          )}
        </span>
        <span>
          {loading
            ? translate('workMonitor.loading', 'Updating provider states…')
            : data?.fetchedAt
              ? translate('workMonitor.synced', 'Checked {{time}}', {
                  time: formatUiRelativeTimeFromDate(data.fetchedAt)
                })
              : ''}
        </span>
      </div>
      {!githubLogin && view === 'attention' ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'workMonitor.identityHint',
            'Enter your GitHub login to see your author and reviewer queues. Plane uses your connected account.'
          )}
        </p>
      ) : null}
      {errors.length ? (
        <div role="alert" className="space-y-1 text-xs text-destructive">
          <p>
            {translate(
              'workMonitor.partial',
              'Some data could not be refreshed. The overview may be incomplete; missing states remain unknown.'
            )}
          </p>
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
      {data?.limited ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'workMonitor.limited',
            'Loaded scope: up to 100 PRs per query and repository, 100 detailed open PR states in total, and 250 tasks per Plane project. Narrow the scope or open the task list for more.'
          )}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {translate('workMonitor.loading', 'Updating provider states…')}
          </div>
        ) : view === 'team' ? (
          <WorkMonitorTeam rows={rows} onSelect={selectRow} />
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-5 xl:grid-cols-2">
            {LANES.map((lane) => {
              const items = rows.filter((row) => personalMonitorLane(row, identity, lane))
              return (
                <section key={lane}>
                  <h3 className="mb-2 flex justify-between gap-3 text-sm font-medium">
                    <span>{monitorLaneLabel(lane)}</span>
                    <span className="tabular-nums text-muted-foreground">{items.length}</span>
                  </h3>
                  {items.length ? (
                    <WorkMonitorRows rows={items} onSelect={selectRow} />
                  ) : (
                    <p className="border-t border-border px-3 py-4 text-xs text-muted-foreground">
                      {translate('workMonitor.emptyQueue', 'No matching loaded items')}
                    </p>
                  )}
                </section>
              )
            })}
          </div>
        )}
        {!loading && !rows.length ? (
          <p className="py-6 text-sm text-muted-foreground">
            {translate(
              'workMonitor.empty',
              'No active tasks were found in the loaded sources. Select repositories or connect Plane.'
            )}
          </p>
        ) : null}
      </div>
      <WorkMonitorDetail row={selectedRow} onClose={() => setSelectedRowId(null)} />
      <PlaneConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={() => {
          setConnectOpen(false)
          void refreshConnection()
        }}
      />
    </div>
  )
}
