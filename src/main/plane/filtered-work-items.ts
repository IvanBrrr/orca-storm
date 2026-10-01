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
            ...(filters.search ? { search: filters.search } : {}),
            ...(filters.stateId ? { state_id: filters.stateId } : {}),
            ...(filters.assigneeId ? { assignee_id: filters.assigneeId } : {}),
            ...(filters.unassigned ? { assignee_id__isnull: 'true' } : {}),
            ...(filters.priority ? { priority: filters.priority } : {}),
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
