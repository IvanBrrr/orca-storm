import { isPlaneJsonRecord } from '../../../shared/plane-json-record'
import { isPlanePriority } from '../../../shared/plane-types'
import type { PlaneSortField, PlaneWorkItemView } from './plane-work-item-view'

const PREFIX = 'storca.plane.task-view.v1.'
const LIMIT_PREFIX = 'storca.plane.task-limit.v1.'
const SORT_FIELDS: PlaneSortField[] = [
  'updated',
  'created',
  'priority',
  'key',
  'title',
  'status',
  'assignee'
]

export function defaultPlaneWorkItemView(): PlaneWorkItemView {
  return {
    search: '',
    stateIds: [],
    assigneeIds: [],
    priorities: [],
    labelIds: [],
    sortField: 'updated',
    sortDirection: 'desc'
  }
}

export function loadPlaneWorkItemView(workspaceId: string, projectId: string): PlaneWorkItemView {
  const fallback = defaultPlaneWorkItemView()
  try {
    const saved = localStorage.getItem(`${PREFIX}${workspaceId}.${projectId}`)
    const value: unknown = saved ? JSON.parse(saved) : null
    if (!isPlaneJsonRecord(value)) {
      return fallback
    }
    return {
      search: typeof value.search === 'string' ? value.search : fallback.search,
      stateIds: selectedIds(value.stateIds, value.stateId),
      assigneeIds: selectedIds(value.assigneeIds, value.assigneeId),
      priorities: selectedIds(value.priorities, value.priority).filter(isPlanePriority),
      labelIds: Array.isArray(value.labelIds)
        ? value.labelIds.filter((id): id is string => typeof id === 'string')
        : [],
      sortField: SORT_FIELDS.find((field) => field === value.sortField) ?? fallback.sortField,
      sortDirection: value.sortDirection === 'asc' ? 'asc' : 'desc'
    }
  } catch {
    return fallback
  }
}

export function savePlaneWorkItemView(
  workspaceId: string,
  projectId: string,
  view: PlaneWorkItemView
): void {
  try {
    localStorage.setItem(`${PREFIX}${workspaceId}.${projectId}`, JSON.stringify(view))
  } catch {
    // The current view remains usable when browser storage is unavailable.
  }
}

export function loadPlaneWorkItemLimit(workspaceId: string, projectId: string): number {
  try {
    const value = Number(localStorage.getItem(`${LIMIT_PREFIX}${workspaceId}.${projectId}`))
    return Number.isInteger(value) && value >= 250 && value <= 2000 ? value : 250
  } catch {
    return 250
  }
}

export function savePlaneWorkItemLimit(
  workspaceId: string,
  projectId: string,
  limit: number
): void {
  try {
    localStorage.setItem(`${LIMIT_PREFIX}${workspaceId}.${projectId}`, String(limit))
  } catch {
    // The current page remains usable when browser storage is unavailable.
  }
}

function selectedIds(values: unknown, legacy: unknown): string[] {
  return Array.isArray(values)
    ? [...new Set(values.filter((id): id is string => typeof id === 'string' && id !== 'all'))]
    : typeof legacy === 'string' && legacy !== 'all'
      ? [legacy]
      : []
}
