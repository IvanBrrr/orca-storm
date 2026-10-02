import {
  parsePlaneWorkItemKey,
  planeWorkItemSearchKey
} from '../../shared/plane-work-item-key-search'
import type {
  PlaneProject,
  PlaneWorkItem,
  PlaneWorkItemListFilters
} from '../../shared/plane-types'
import {
  buildQuery,
  planeRequest,
  workspacePath,
  type PlaneClientForWorkspace
} from './authenticated-request'
import { listAllV2Pages } from './cursor-pagination'
import { mapPlaneWorkItem, PLANE_WORK_ITEM_EXPAND } from './work-item-mapping'

export async function listFilteredWorkItems(
  client: PlaneClientForWorkspace,
  project: PlaneProject,
  options: { filters: PlaneWorkItemListFilters; orderBy?: string; maxItems: number }
): Promise<{ items: PlaneWorkItem[]; truncated: boolean; serverFiltered: true }> {
  const { filters } = options
  const key = filters.search ? planeWorkItemSearchKey(filters.search, project.identifier) : null
  const keyParts = key ? parsePlaneWorkItemKey(key) : null
  if (keyParts && keyParts.projectIdentifier !== project.identifier.toUpperCase()) {
    return { items: [], truncated: false, serverFiltered: true }
  }
  if (filters.unassigned && (filters.assigneeIds?.length || filters.assigneeId)) {
    const [assigned, unassigned] = await Promise.all([
      listFilteredWorkItems(client, project, {
        ...options,
        filters: { ...filters, unassigned: false }
      }),
      listFilteredWorkItems(client, project, {
        ...options,
        filters: { ...filters, assigneeIds: [], assigneeId: '' }
      })
    ])
    const items = [
      ...new Map([...assigned.items, ...unassigned.items].map((item) => [item.id, item])).values()
    ]
    const created = (options.orderBy ?? '-created_at').includes('created')
    const direction = options.orderBy?.startsWith('-') === false ? 1 : -1
    items.sort(
      (a, b) =>
        direction *
        (created ? a.createdAt.localeCompare(b.createdAt) : a.updatedAt.localeCompare(b.updatedAt))
    )
    return {
      items: items.slice(0, options.maxItems),
      truncated: assigned.truncated || unassigned.truncated || items.length > options.maxItems,
      serverFiltered: true
    }
  }
  const { items, truncated } = await listAllV2Pages(
    (cursor, offset) =>
      planeRequest(
        client,
        `${workspacePath(client.workspace, `projects/${encodeURIComponent(project.id)}/work-items/`)}${buildQuery(
          {
            per_page: 200,
            paginate: 'cursor',
            expand: PLANE_WORK_ITEM_EXPAND,
            order_by: options.orderBy ?? '-created_at',
            ...(keyParts
              ? { sequence_id: keyParts.sequenceId }
              : filters.search
                ? { search: filters.search }
                : {}),
            ...(filters.stateIds?.length
              ? { state_id__in: filters.stateIds }
              : filters.stateId
                ? { state_id: filters.stateId }
                : {}),
            ...(filters.assigneeIds?.length
              ? { assignee_id__in: filters.assigneeIds }
              : filters.assigneeId
                ? { assignee_id: filters.assigneeId }
                : {}),
            ...(filters.unassigned ? { assignee_id__isnull: 'true' } : {}),
            ...(filters.priorities?.length
              ? { priority__in: filters.priorities }
              : filters.priority
                ? { priority: filters.priority }
                : {}),
            ...(filters.labelIds?.length ? { label_id__in: filters.labelIds.join(',') } : {}),
            ...(cursor ? { cursor } : {}),
            ...(offset === undefined ? {} : { offset })
          }
        )}`,
        undefined,
        'v2'
      ),
    options.maxItems
  )
  const context = { workspace: client.workspace, project }
  const mapped = items.map((raw) => mapPlaneWorkItem(raw, context))
  if (mapped.some((item) => item === null)) {
    throw new Error('Plane returned work items without a readable state.')
  }
  return {
    items: mapped.filter((item): item is PlaneWorkItem => item !== null),
    truncated,
    serverFiltered: true
  }
}
