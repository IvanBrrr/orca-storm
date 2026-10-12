import { defineMethod } from '../core'
import {
  AddComment,
  Connect,
  CreateWorkItem,
  GetWorkItem,
  ListWorkItems,
  ProjectId,
  SearchWorkItems,
  SelectWorkspace,
  UpdateWorkItem,
  WorkItemScope,
  WorkspaceScope
} from '../../../../shared/rpc-contract/plane-params'

/**
 * Registered unconditionally for every build, so `plane.provider.v1` is a
 * STATIC capability advertised by getStatus() automatically — clients gate on
 * it to avoid calling a host that predates the Plane provider.
 */
export const PLANE_METHODS = [
  defineMethod({
    name: 'plane.connect',
    permission: 'accounts-admin',
    params: Connect,
    handler: async (params, { runtime }) =>
      runtime.planeConnect({
        baseUrl: params.baseUrl.trim(),
        workspaceSlug: params.workspaceSlug.trim(),
        apiToken: params.apiToken.trim(),
        ...(params.appUrl ? { appUrl: params.appUrl.trim() } : {})
      })
  }),
  defineMethod({
    name: 'plane.disconnect',
    permission: 'accounts-admin',
    params: WorkspaceScope,
    handler: async (params, { runtime }) => runtime.planeDisconnect(params?.workspaceId)
  }),
  defineMethod({
    name: 'plane.status',
    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.planeStatus()
  }),
  defineMethod({
    name: 'plane.selectWorkspace',
    permission: 'accounts-admin',
    params: SelectWorkspace,
    handler: async (params, { runtime }) => runtime.planeSelectWorkspace(params.workspaceId)
  }),
  defineMethod({
    name: 'plane.testConnection',
    permission: 'workspace',
    params: WorkspaceScope,
    handler: async (params, { runtime }) => runtime.planeTestConnection(params?.workspaceId)
  }),
  defineMethod({
    name: 'plane.listProjects',
    permission: 'workspace',
    params: WorkspaceScope,
    handler: async (params, { runtime }) => runtime.planeListProjects(params?.workspaceId)
  }),
  defineMethod({
    name: 'plane.listStates',
    permission: 'workspace',
    params: ProjectId,
    handler: async (params, { runtime }) =>
      runtime.planeListStates(params.projectId, params.workspaceId)
  }),
  defineMethod({
    name: 'plane.listLabels',
    permission: 'workspace',
    params: ProjectId,
    handler: async (params, { runtime }) =>
      runtime.planeListLabels(params.projectId, params.workspaceId)
  }),
  defineMethod({
    name: 'plane.listMembers',
    permission: 'workspace',
    params: WorkspaceScope,
    handler: async (params, { runtime }) => runtime.planeListMembers(params?.workspaceId)
  }),
  defineMethod({
    name: 'plane.listWorkItems',
    permission: 'workspace',
    params: ListWorkItems,
    handler: async (params, { runtime }) => runtime.planeListWorkItems(params)
  }),
  defineMethod({
    name: 'plane.getWorkItem',
    permission: 'workspace',
    params: GetWorkItem,
    handler: async (params, { runtime }) => runtime.planeGetWorkItem(params)
  }),
  defineMethod({
    name: 'plane.searchWorkItems',
    permission: 'workspace',
    params: SearchWorkItems,
    // Why: search is hit per keystroke. Forwarding the transport signal lets a
    // disconnecting client release the request instead of running it to
    // completion against Plane's 60/minute budget.
    handler: async (params, { runtime, signal }) =>
      runtime.planeSearchWorkItems({ ...params, ...(signal ? { signal } : {}) })
  }),
  defineMethod({
    name: 'plane.workItemComments',
    permission: 'workspace',
    params: WorkItemScope,
    handler: async (params, { runtime }) => runtime.planeWorkItemComments(params)
  }),
  defineMethod({
    name: 'plane.updateWorkItem',
    permission: 'workspace',
    params: UpdateWorkItem,
    handler: async (params, { runtime }) => runtime.planeUpdateWorkItem(params)
  }),
  defineMethod({
    name: 'plane.addComment',
    permission: 'workspace',
    params: AddComment,
    handler: async (params, { runtime }) => runtime.planeAddComment(params)
  }),
  defineMethod({
    name: 'plane.createWorkItem',
    permission: 'workspace',
    params: CreateWorkItem,
    handler: async (params, { runtime }) => runtime.planeCreateWorkItem(params)
  })
]
