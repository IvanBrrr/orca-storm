import type { PlaneWorkItem } from '../../../shared/plane-types'

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
  stateId: string
  assigneeId: string
  priority: string
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

export function selectPlaneWorkItems(
  items: PlaneWorkItem[],
  view: PlaneWorkItemView
): PlaneWorkItem[] {
  const search = view.search.trim().toLocaleLowerCase()
  const matching = items.filter((item) => {
    if (search && !`${item.key} ${item.title}`.toLocaleLowerCase().includes(search)) {
      return false
    }
    if (view.stateId !== 'all' && item.state.id !== view.stateId) {
      return false
    }
    if (view.priority !== 'all' && item.priority !== view.priority) {
      return false
    }
    if (view.assigneeId === 'unassigned' && item.assignees.length > 0) {
      return false
    }
    if (
      view.assigneeId !== 'all' &&
      view.assigneeId !== 'unassigned' &&
      !item.assignees.some((assignee) => assignee.id === view.assigneeId)
    ) {
      return false
    }
    return true
  })

  const direction = view.sortDirection === 'asc' ? 1 : -1
  return matching.sort((left, right) => {
    let result: number
    switch (view.sortField) {
      case 'created':
        result = left.createdAt.localeCompare(right.createdAt)
        break
      case 'updated':
        result = left.updatedAt.localeCompare(right.updatedAt)
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
