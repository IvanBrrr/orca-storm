import type { PlaneWorkItem, PlaneWorkItemListFilters } from './plane-types'

export function matchesPlaneWorkItemFilters(
  item: PlaneWorkItem,
  filters: PlaneWorkItemListFilters
): boolean {
  const search = filters.search?.trim().toLocaleLowerCase()
  if (search && !`${item.key} ${item.title}`.toLocaleLowerCase().includes(search)) {
    return false
  }
  const states = filters.stateIds ?? (filters.stateId ? [filters.stateId] : [])
  const priorities = filters.priorities ?? (filters.priority ? [filters.priority] : [])
  const assignees = filters.assigneeIds ?? (filters.assigneeId ? [filters.assigneeId] : [])
  return (
    (!states.length || states.includes(item.state.id)) &&
    (!priorities.length || priorities.includes(item.priority)) &&
    (!filters.labelIds?.length ||
      item.labels.some((label) => filters.labelIds?.includes(label.id))) &&
    ((!assignees.length && !filters.unassigned) ||
      (filters.unassigned === true && !item.assignees.length) ||
      item.assignees.some((member) => assignees.includes(member.id)))
  )
}
