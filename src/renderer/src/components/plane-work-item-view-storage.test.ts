// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadPlaneWorkItemLimit,
  loadPlaneWorkItemView,
  savePlaneWorkItemLimit,
  savePlaneWorkItemView
} from './plane-work-item-view-storage'

describe('saved Plane Tasks view', () => {
  it('migrates saved single selections to multi-select facets', () => {
    localStorage.setItem(
      'storca.plane.task-view.v1.workspace.project',
      JSON.stringify({ stateId: 'todo', assigneeId: 'alice', priority: 'high' })
    )
    expect(loadPlaneWorkItemView('workspace', 'project')).toMatchObject({
      stateIds: ['todo'],
      assigneeIds: ['alice'],
      priorities: ['high']
    })
  })
  beforeEach(() => localStorage.clear())

  it('restores filters and sorting for the same project without applying them to another', () => {
    const view = {
      ...loadPlaneWorkItemView('workspace', 'project'),
      assigneeIds: ['alice'],
      labelIds: ['red', 'blue'],
      sortField: 'priority' as const
    }
    savePlaneWorkItemView('workspace', 'project', view)
    expect(loadPlaneWorkItemView('workspace', 'project')).toEqual(view)
    expect(loadPlaneWorkItemView('workspace', 'other').labelIds).toEqual([])
  })

  it('keeps the amount loaded for the selected project', () => {
    savePlaneWorkItemLimit('workspace', 'project', 750)
    expect(loadPlaneWorkItemLimit('workspace', 'project')).toBe(750)
    expect(loadPlaneWorkItemLimit('workspace', 'other')).toBe(250)
  })
})
