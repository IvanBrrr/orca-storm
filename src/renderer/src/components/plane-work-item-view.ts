import { matchesPlaneWorkItemFilters } from '../../../shared/plane-work-item-filters'
import {
  isPlanePriority,
  type PlaneWorkItem,
  type PlaneWorkItemListFilters
} from '../../../shared/plane-types'

export type PlaneSortField =
  | 'updated'
  | 'created'
  | 'priority'
  | 'key'
  | 'title'
  | 'status'
  | 'assignee'
export type PlaneSortDirection = 'asc' | 'desc'

export type PlaneWorkItemView = {
  search: string
  stateIds: string[]
  assigneeIds: string[]
  priorities: string[]
  labelIds: string[]
  sortField: PlaneSortField
  sortDirection: PlaneSortDirection
}

const PRIORITY_ORDER: Record<PlaneWorkItem['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4
}
const KEY_COLLATOR = new Intl.Collator(undefined, { numeric: true })

export function planeWorkItemOrderBy(view: PlaneWorkItemView): string {
  if (view.sortField === 'created' || view.sortField === 'updated') {
    const field = view.sortField === 'created' ? 'created_at' : 'updated_at'
    return view.sortDirection === 'desc' ? `-${field}` : field
  }
  return '-updated_at'
}

export function planeWorkItemFilters(
  view: Pick<PlaneWorkItemView, 'search' | 'stateIds' | 'assigneeIds' | 'priorities' | 'labelIds'>
): PlaneWorkItemListFilters {
  const search = view.search.trim()
  const assigneeIds = view.assigneeIds.filter((id) => id !== 'unassigned')
  return {
    ...(search ? { search } : {}),
    ...(view.stateIds.length ? { stateIds: view.stateIds } : {}),
    ...(assigneeIds.length ? { assigneeIds } : {}),
    ...(view.assigneeIds.includes('unassigned') ? { unassigned: true } : {}),
    ...(view.priorities.length ? { priorities: view.priorities.filter(isPlanePriority) } : {}),
    ...(view.labelIds.length ? { labelIds: view.labelIds } : {})
  }
}

export function selectPlaneWorkItems(
  items: PlaneWorkItem[],
  view: PlaneWorkItemView
): PlaneWorkItem[] {
  const filters = planeWorkItemFilters(view)
  const matching = items.filter((item) => matchesPlaneWorkItemFilters(item, filters))

  const direction = view.sortDirection === 'asc' ? 1 : -1
  return matching.sort((left, right) => {
    let result: number
    switch (view.sortField) {
      case 'created':
        result = left.createdAt.localeCompare(right.createdAt)
        break
      case 'updated':
        result =
          left.updatedAt && right.updatedAt ? left.updatedAt.localeCompare(right.updatedAt) : 0
        if (!left.updatedAt && !right.updatedAt) {
          return 0
        }
        break
      case 'priority':
        result = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
        return view.sortDirection === 'asc' ? -result : result
      case 'key':
        result = KEY_COLLATOR.compare(left.key, right.key)
        break
      case 'title':
        result = left.title.localeCompare(right.title)
        break
      case 'status':
        result = left.state.name.localeCompare(right.state.name)
        break
      case 'assignee':
        result = (left.assignees[0]?.displayName ?? '').localeCompare(
          right.assignees[0]?.displayName ?? ''
        )
        break
    }
    return result * direction || KEY_COLLATOR.compare(left.key, right.key)
  })
}
