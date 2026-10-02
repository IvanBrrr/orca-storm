import { PlaneWorkItemFilterPicker } from './plane-work-item-filter-picker'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type {
  PlaneLabel,
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
  states,
  assignees,
  labels,
  view,
  onViewChange
}: {
  items: PlaneWorkItem[]
  states: PlaneState[]
  assignees: PlaneMember[]
  labels: PlaneLabel[]
  view: PlaneWorkItemView
  onViewChange: (view: PlaneWorkItemView) => void
}): React.JSX.Element {
  const stateMap = new Map<string, PlaneState>(states.map((state) => [state.id, state]))
  const assigneeMap = new Map<string, PlaneMember>(assignees.map((member) => [member.id, member]))
  const labelMap = new Map<string, PlaneLabel>(labels.map((label) => [label.id, label]))
  for (const item of items) {
    stateMap.set(item.state.id, item.state)
    for (const assignee of item.assignees) {
      assigneeMap.set(assignee.id, assignee)
    }
    for (const label of item.labels) {
      labelMap.set(label.id, label)
    }
  }
  const stateOptions = [...stateMap.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  )
  const assigneeOptions = [...assigneeMap.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName)
  )
  const labelOptions = [...labelMap.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
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
            'Search work items'
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
      <PlaneWorkItemFilterPicker
        label={translate('auto.components.TaskPagePlaneControls.status', 'Status')}
        allLabel={translate('auto.components.TaskPagePlaneControls.allStatuses', 'All statuses')}
        options={stateOptions.map((state) => ({ id: state.id, label: state.name }))}
        selected={view.stateIds}
        onChange={(stateIds) => onViewChange({ ...view, stateIds })}
      />
      <PlaneWorkItemFilterPicker
        label={translate('auto.components.TaskPagePlaneControls.labels', 'Labels')}
        allLabel={translate('auto.components.TaskPagePlaneControls.allLabels', 'All labels')}
        options={labelOptions.map((label) => ({ id: label.id, label: label.name }))}
        selected={view.labelIds}
        onChange={(labelIds) => onViewChange({ ...view, labelIds })}
      />
      <PlaneWorkItemFilterPicker
        label={translate('auto.components.TaskPagePlaneControls.assignee', 'Assignee')}
        allLabel={translate('auto.components.TaskPagePlaneControls.allAssignees', 'All assignees')}
        options={[
          {
            id: 'unassigned',
            label: translate('auto.components.TaskPagePlaneControls.unassigned', 'Unassigned')
          },
          ...assigneeOptions.map((member) => ({ id: member.id, label: member.displayName }))
        ]}
        selected={view.assigneeIds}
        onChange={(assigneeIds) => onViewChange({ ...view, assigneeIds })}
      />
      <PlaneWorkItemFilterPicker
        label={translate('auto.components.TaskPagePlaneControls.priority', 'Priority')}
        allLabel={translate(
          'auto.components.TaskPagePlaneControls.allPriorities',
          'All priorities'
        )}
        options={PLANE_PRIORITIES.map((priority) => ({
          id: priority,
          label: priorityLabel(priority)
        }))}
        selected={view.priorities}
        onChange={(priorities) => onViewChange({ ...view, priorities })}
      />
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
