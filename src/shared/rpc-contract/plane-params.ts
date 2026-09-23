import { z } from 'zod'
import { PLANE_PRIORITIES } from '../plane-types'
import { OptionalString, requiredString } from './rpc-param-primitives'

// Why: the IPC boundary clamps its limits, so the RPC boundary must too or a
// remote client can send limit: 0 (an empty list reported as truncated) or a
// negative limit (silently drops the last row).
const boundedLimit = (max: number) => z.coerce.number().int().min(1).max(max).optional()

export const WorkspaceScope = z.object({ workspaceId: OptionalString }).optional()

export const Connect = z.object({
  baseUrl: requiredString('Plane URL is required'),
  workspaceSlug: requiredString('Workspace slug is required'),
  apiToken: requiredString('API token is required'),
  appUrl: OptionalString
})

export const SelectWorkspace = z.object({
  workspaceId: requiredString('Workspace is required')
})

// The renderer echoes back a project it read from plane.listProjects; the
// identifier and name only feed display keys and links, never authorization.
export const Project = z
  .object({
    id: requiredString('Project id is required'),
    identifier: requiredString('Project identifier is required'),
    name: OptionalString
  })
  // Normalized here so handlers receive a complete PlaneProject, matching what
  // the local IPC path builds.
  .transform((value) => {
    const identifier = value.identifier.trim().toUpperCase()
    return { id: value.id.trim(), identifier, name: value.name?.trim() || identifier }
  })

export const ProjectScope = z.object({
  project: Project,
  workspaceId: OptionalString
})

export const ListWorkItems = ProjectScope.extend({
  orderBy: OptionalString,
  limit: boundedLimit(250)
})

export const GetWorkItem = z.object({
  key: requiredString('Work item key is required'),
  workspaceId: OptionalString,
  project: Project.optional()
})

export const SearchWorkItems = z.object({
  search: requiredString('Missing search text'),
  limit: boundedLimit(100),
  projectId: OptionalString,
  workspaceId: OptionalString
})

export const WorkItemScope = ProjectScope.extend({
  workItemId: requiredString('Work item id is required')
})

const NullableStringArray = z.union([z.array(z.string()), z.null()]).optional()

export const UpdateWorkItem = WorkItemScope.extend({
  updates: z.object({
    title: OptionalString,
    stateId: OptionalString,
    priority: z.enum(PLANE_PRIORITIES).optional(),
    assigneeIds: NullableStringArray,
    labelIds: NullableStringArray,
    targetDate: z.union([z.string(), z.null()]).optional()
  })
})

export const AddComment = WorkItemScope.extend({
  body: requiredString('A comment needs some text')
})

export const CreateWorkItem = ProjectScope.extend({
  title: requiredString('Title is required'),
  description: OptionalString,
  stateId: OptionalString,
  priority: z.enum(PLANE_PRIORITIES).optional(),
  assigneeIds: z.array(z.string()).optional(),
  labelIds: z.array(z.string()).optional()
})

export const ProjectId = z.object({
  projectId: requiredString('Project id is required'),
  workspaceId: OptionalString
})
