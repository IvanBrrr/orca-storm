import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { useAppStore } from '@/store'
import { getTaskPageRepoSourceContext } from '../task-page-source-context'
import { monitorReasonLabel } from './work-monitor-copy'
import type { MonitorRow } from './work-monitor-model'
import { WorkMonitorActivity } from './WorkMonitorActivity'

export function WorkMonitorDetail({
  row,
  onClose
}: {
  row: MonitorRow | null
  onClose: () => void
}): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const openTaskPage = useAppStore((s) => s.openTaskPage)
  return (
    <Sheet
      open={Boolean(row)}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{row?.title}</SheetTitle>
          <SheetDescription>
            {translate(
              'workMonitor.detailDescription',
              'Provider states and the next required actions.'
            )}
          </SheetDescription>
        </SheetHeader>
        {row ? (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-5 scrollbar-sleek">
            <section>
              <h3 className="mb-2 text-sm font-medium">
                {translate('workMonitor.nextActions', 'Next actions')}
              </h3>
              <ul className="space-y-2 text-[13px]">
                {row.actions.map((action) => (
                  <li key={`${action.reason}:${action.person?.id}:${action.prUrl}`}>
                    {action.person?.name ?? translate('workMonitor.unassigned', 'Unassigned')} →{' '}
                    {monitorReasonLabel(action.reason)}
                  </li>
                ))}
              </ul>
            </section>
            {row.plane ? (
              <section className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-medium">
                  {row.plane.key} · {translate('workMonitor.planeLabel', 'Plane')}
                </h3>
                <p className="text-xs">
                  {row.plane.project.name} · {row.plane.state.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {translate('workMonitor.updated', 'Updated {{time}}', {
                    time: formatUiRelativeTimeFromDate(row.plane.updatedAt)
                  })}
                </p>
                {row.prs.length ? (
                  <p className="text-xs text-muted-foreground">
                    {translate(
                      'workMonitor.linkEvidence',
                      'Linked by the unique Plane key in the PR title or branch. Other PRs may exist outside the loaded scope.'
                    )}
                  </p>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (row.plane) {
                      void window.api.shell.openUrl(row.plane.url)
                    }
                  }}
                >
                  {translate('workMonitor.openPlane', 'Open in Plane')}
                </Button>
              </section>
            ) : null}
            {row.prs.map((pr) => (
              <section key={pr.url} className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-medium">
                  {translate('workMonitor.prNumber', 'PR #{{number}}', { number: pr.number })} ·{' '}
                  {pr.title}
                </h3>
                <p className="text-xs">
                  {pr.author} · {pr.state}
                </p>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <dt className="text-muted-foreground">
                    {translate('workMonitor.reviewState', 'Review')}
                  </dt>
                  <dd>
                    {pr.reviewDecision ?? translate('workMonitor.unavailable', 'Not available')}
                  </dd>
                  <dt className="text-muted-foreground">
                    {translate('workMonitor.ciLabel', 'CI')}
                  </dt>
                  <dd>
                    {pr.checksSummary?.state ??
                      translate('workMonitor.unavailable', 'Not available')}
                  </dd>
                  <dt className="text-muted-foreground">
                    {translate('workMonitor.mergeState', 'Merge')}
                  </dt>
                  <dd>
                    {pr.mergeStateStatus ??
                      pr.mergeable ??
                      translate('workMonitor.unavailable', 'Not available')}
                  </dd>
                </dl>
                <p className="text-xs text-muted-foreground">
                  {translate('workMonitor.updated', 'Updated {{time}}', {
                    time: formatUiRelativeTimeFromDate(pr.updatedAt)
                  })}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const repo = repos.find((r) => r.id === pr.repoId)
                    if (!repo) {
                      return
                    }
                    onClose()
                    openTaskPage({
                      taskSource: 'github',
                      preselectedRepoId: repo.id,
                      openGitHubWorkItem: pr,
                      openGitHubSourceContext: getTaskPageRepoSourceContext(repo, 'github')
                    })
                  }}
                >
                  {translate('workMonitor.openPR', 'Open pull request')}
                </Button>
              </section>
            ))}
            {row.prs.length ? <WorkMonitorActivity key={row.id} row={row} /> : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
