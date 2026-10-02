import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { monitorPeople, monitorPRPerson, type MonitorRow } from './work-monitor-model'
import { WorkMonitorRows } from './WorkMonitorRows'

export function WorkMonitorTeam({
  rows,
  onSelect
}: {
  rows: MonitorRow[]
  onSelect: (row: MonitorRow) => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const people = monitorPeople(rows)
  const selectedPerson = people.find((p) => p.id === selected)
  const reviewRoutingUnknown = new Set(
    rows.flatMap((row) =>
      row.actions
        .filter((action) => action.lane === 'unknown')
        .map((action) => action.prUrl)
        .filter(Boolean)
    )
  ).size
  const needsChanges = rows.filter((r) => r.actions.some((a) => a.lane === 'author'))
  const unclear = rows.filter((r) => r.actions.some((a) => a.lane === 'unknown' || !a.person))
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto scrollbar-sleek">
        <table className="w-full text-left text-[13px]">
          <caption className="pb-3 text-left text-xs text-muted-foreground">
            {translate(
              'workMonitor.teamScope',
              'Team overview for the loaded repositories and Plane projects. Other accounts are kept separate across providers.'
            )}
          </caption>
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">{translate('workMonitor.person', 'Person')}</th>
              <th className="px-3 py-2 text-right font-medium">
                {translate('workMonitor.working', 'In progress')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {translate('workMonitor.openPRs', 'Own open PRs')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {translate('workMonitor.reviewQueue', 'Requested reviews')}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {translate('workMonitor.authorQueue', 'Author actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => {
              const owned = rows.filter((r) => r.participants.some((p) => p.id === person.id))
              const prs = owned
                .flatMap((r) => r.prs)
                .filter((pr) => monitorPRPerson(pr)?.id === person.id && pr.state !== 'merged')
              const countLane = (lane: string): number =>
                rows.filter((r) =>
                  r.actions.some((a) => a.person?.id === person.id && a.lane === lane)
                ).length
              const reviewCount = new Set(
                rows.flatMap((row) =>
                  row.actions
                    .filter(
                      (action) => action.person?.id === person.id && action.lane === 'reviewer'
                    )
                    .map((action) => action.prUrl)
                    .filter(Boolean)
                )
              ).size
              return (
                <tr key={person.id} className="border-b border-border hover:bg-accent">
                  <td className="px-3 py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-pressed={selected === person.id}
                      onClick={() => setSelected(selected === person.id ? null : person.id)}
                    >
                      {person.name}
                    </Button>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {person.id.startsWith('github:') ? (person.host ?? 'GitHub') : 'Plane'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{countLane('working')}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{prs.length}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{reviewCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{countLane('author')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {translate(
          'workMonitor.reviewBottlenecks',
          '{{reviews}} PRs with unconfirmed review routing · {{changes}} tasks need author actions',
          { reviews: reviewRoutingUnknown, changes: needsChanges.length }
        )}
      </p>
      {unclear.length ? (
        <section>
          <h3 className="mb-2 text-sm font-medium">
            {translate('workMonitor.unknown', 'Next turn unclear')}
          </h3>
          <WorkMonitorRows rows={unclear} onSelect={onSelect} />
        </section>
      ) : null}
      {selectedPerson ? (
        <section>
          <h3 className="mb-2 text-sm font-medium">{selectedPerson.name}</h3>
          <WorkMonitorRows
            rows={rows.filter((r) => r.participants.some((p) => p.id === selected))}
            onSelect={onSelect}
          />
        </section>
      ) : null}
    </div>
  )
}
