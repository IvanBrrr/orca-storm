import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { translate } from '@/i18n/i18n'
import { monitorReasonLabel } from './work-monitor-copy'
import type { MonitorRow } from './work-monitor-model'

export function WorkMonitorRows({
  rows,
  onSelect
}: {
  rows: readonly MonitorRow[]
  onSelect: (row: MonitorRow) => void
}): React.JSX.Element {
  return (
    <div className="divide-y divide-border">
      {rows.map((row) => (
        <button
          type="button"
          key={row.id}
          onClick={() => onSelect(row)}
          className="flex w-full flex-col gap-1 px-3 py-3 text-left hover:bg-accent focus-visible:outline-ring"
        >
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {row.plane?.key ?? `#${row.prs[0]?.number}`}
            </span>
            <span className="min-w-0 break-words text-[13px] font-medium">{row.title}</span>
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {row.actions.map((action) => (
              <span key={`${action.reason}:${action.person?.id}:${action.prUrl}`}>
                {action.person?.name ?? translate('workMonitor.unassigned', 'Unassigned')} →{' '}
                {monitorReasonLabel(action.reason)}
              </span>
            ))}
          </span>
          <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            {row.prs.map((pr) => (
              <span key={pr.url}>
                PR #{pr.number} · {pr.state} ·{' '}
                {pr.prRepo ? `${pr.prRepo.owner}/${pr.prRepo.repo}` : pr.author}
              </span>
            ))}
            <span>
              {translate('workMonitor.updated', 'Updated {{time}}', {
                time: formatUiRelativeTimeFromDate(row.updatedAt)
              })}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}
