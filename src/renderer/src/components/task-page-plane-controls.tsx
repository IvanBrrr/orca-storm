import { ArrowDown, ArrowUp } from 'lucide-react'
import type {
  PlaneMember,
  PlanePriority,
  PlaneState,
  PlaneWorkItem
} from '../../../shared/plane-types'
import { PLANE_PRIORITIES } from '../../../shared/plane-types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import type { PlaneSortField, PlaneWorkItemView } from './plane-work-item-view'

const SORT_FIELDS: PlaneSortField[] = [
  'updated',
  'created',
  'priority',
  'key',
  'title',
  'status',
  'assignee'
]

function sortLabel(field: PlaneSortField): string {
  switch (field) {
    case 'updated':
      return translate('auto.components.TaskPagePlaneControls.updated', 'Updated')
    case 'created':
      return translate('auto.components.TaskPagePlaneControls.created', 'Created')
    case 'priority':
      return translate('auto.components.TaskPagePlaneControls.priority', 'Priority')
    case 'key':
      return translate('auto.components.TaskPagePlaneControls.key', 'Key')
    case 'title':
      return translate('auto.components.TaskPagePlaneControls.title', 'Title')
    case 'status':
      return translate('auto.components.TaskPagePlaneControls.status', 'Status')
    case 'assignee':
      return translate('auto.components.TaskPagePlaneControls.assignee', 'Assignee')
  }
}

function priorityLabel(priority: PlanePriority): string {
  switch (priority) {
    case 'urgent':
      return translate('auto.components.TaskPagePlaneControls.urgent', 'Urgent')
    case 'high':
      return translate('auto.components.TaskPagePlaneControls.high', 'High')
    case 'medium':
      return translate('auto.components.TaskPagePlaneControls.medium', 'Medium')
    case 'low':
      return translate('auto.components.TaskPagePlaneControls.low', 'Low')
    case 'none':
      return translate('auto.components.TaskPagePlaneControls.none', 'None')
  }
}

export function TaskPagePlaneControls({
  items,
  view,
  onViewChange
}: {
  items: PlaneWorkItem[]
  view: PlaneWorkItemView
  onViewChange: (view: PlaneWorkItemView) => void
}): React.JSX.Element {
  const states = new Map<string, PlaneState>()
  const assignees = new Map<string, PlaneMember>()
  for (const item of items) {
    states.set(item.state.id, item.state)
    for (const assignee of item.assignees) {
      assignees.set(assignee.id, assignee)
    }
  }
  const stateOptions = [...states.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
  const assigneeOptions = [...assignees.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName)
  )
  const sortByLabel = translate('auto.components.TaskPagePlaneControls.sortBy', 'Sort by')
  const directionLabel =
    view.sortDirection === 'desc'
      ? translate('auto.components.TaskPagePlaneControls.descending', 'Descending')
      : translate('auto.components.TaskPagePlaneControls.ascending', 'Ascending')

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-muted/25 px-3 py-2">
      <div className="min-w-36 flex-1 sm:max-w-72">
        <Input
          type="search"
          aria-label={translate(
            'auto.components.TaskPagePlaneControls.search',
            'Search loaded work items'
          )}
          placeholder={translate(
            'auto.components.TaskPagePlaneControls.searchPlaceholder',
            'Search key or title'
          )}
          value={view.search}
          onChange={(event) => onViewChange({ ...view, search: event.target.value })}
          className="h-8"
        />
      </div>
      <Select value={view.stateId} onValueChange={(stateId) => onViewChange({ ...view, stateId })}>
        <SelectTrigger
          size="sm"
          aria-label={translate('auto.components.TaskPagePlaneControls.status', 'Status')}
          className="w-36"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {translate('auto.components.TaskPagePlaneControls.allStatuses', 'All statuses')}
          </SelectItem>
          {stateOptions.map((state) => (
            <SelectItem key={state.id} value={state.id}>
              {state.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={view.assigneeId}
        onValueChange={(assigneeId) => onViewChange({ ...view, assigneeId })}
      >
        <SelectTrigger
          size="sm"
          aria-label={translate('auto.components.TaskPagePlaneControls.assignee', 'Assignee')}
          className="w-40"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {translate('auto.components.TaskPagePlaneControls.allAssignees', 'All assignees')}
          </SelectItem>
          <SelectItem value="unassigned">
            {translate('auto.components.TaskPagePlaneControls.unassigned', 'Unassigned')}
          </SelectItem>
          {assigneeOptions.map((assignee) => (
            <SelectItem key={assignee.id} value={assignee.id}>
              {assignee.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={view.priority}
        onValueChange={(priority) => onViewChange({ ...view, priority })}
      >
        <SelectTrigger
          size="sm"
          aria-label={translate('auto.components.TaskPagePlaneControls.priority', 'Priority')}
          className="w-32"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">
            {translate('auto.components.TaskPagePlaneControls.allPriorities', 'All priorities')}
          </SelectItem>
          {PLANE_PRIORITIES.map((priority) => (
            <SelectItem key={priority} value={priority}>
              {priorityLabel(priority)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={view.sortField}
        onValueChange={(value) => {
          const sortField = SORT_FIELDS.find((field) => field === value)
          if (sortField) {
            onViewChange({ ...view, sortField })
          }
        }}
      >
        <span className="text-xs text-muted-foreground">{sortByLabel}</span>
        <SelectTrigger size="sm" aria-label={sortByLabel} className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_FIELDS.map((field) => (
            <SelectItem key={field} value={field}>
              {sortLabel(field)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={directionLabel}
            onClick={() =>
              onViewChange({
                ...view,
                sortDirection: view.sortDirection === 'asc' ? 'desc' : 'asc'
              })
            }
          >
            {view.sortDirection === 'asc' ? <ArrowUp /> : <ArrowDown />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{directionLabel}</TooltipContent>
      </Tooltip>
    </div>
  )
}
