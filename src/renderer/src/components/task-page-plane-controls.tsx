import { ArrowDown, ArrowUp, Check, ChevronsUpDown } from 'lucide-react'
import type {
  PlaneLabel,
  PlaneMember,
  PlanePriority,
  PlaneState,
  PlaneWorkItem
} from '../../../shared/plane-types'
import { PLANE_PRIORITIES } from '../../../shared/plane-types'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useState } from 'react'
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
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [labelSearch, setLabelSearch] = useState('')
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
      <Popover open={labelsOpen} onOpenChange={setLabelsOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={labelsOpen}
            aria-label={translate('auto.components.TaskPagePlaneControls.labels', 'Labels')}
            className="w-36 justify-between"
          >
            {view.labelIds.length
              ? `${translate('auto.components.TaskPagePlaneControls.labels', 'Labels')} (${view.labelIds.length})`
              : translate('auto.components.TaskPagePlaneControls.allLabels', 'All labels')}
            <ChevronsUpDown className="size-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={translate(
                'auto.components.TaskPagePlaneControls.searchLabels',
                'Search labels'
              )}
              value={labelSearch}
              onValueChange={setLabelSearch}
            />
            <CommandList>
              <CommandEmpty>
                {translate('auto.components.TaskPagePlaneControls.noLabels', 'No labels found')}
              </CommandEmpty>
              {labelOptions
                .filter((label) =>
                  label.name.toLocaleLowerCase().includes(labelSearch.toLocaleLowerCase())
                )
                .map((label) => (
                  <CommandItem
                    key={label.id}
                    value={label.id}
                    onSelect={() =>
                      onViewChange({
                        ...view,
                        labelIds: view.labelIds.includes(label.id)
                          ? view.labelIds.filter((id) => id !== label.id)
                          : [...view.labelIds, label.id]
                      })
                    }
                  >
                    <Check
                      className={
                        view.labelIds.includes(label.id) ? 'size-3.5' : 'size-3.5 opacity-0'
                      }
                    />
                    {label.name}
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
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
