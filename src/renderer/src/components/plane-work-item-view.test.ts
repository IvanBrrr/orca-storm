import { describe, expect, it } from 'vitest'
import type { PlaneWorkItem } from '../../../shared/plane-types'
import {
  planeWorkItemOrderBy,
  selectPlaneWorkItems,
  type PlaneWorkItemView
} from './plane-work-item-view'

const defaultView: PlaneWorkItemView = {
  search: '',
  stateIds: [],
  assigneeIds: [],
  priorities: [],
  labelIds: [],
  sortField: 'updated',
  sortDirection: 'desc'
}

function item(key: string, overrides: Partial<PlaneWorkItem> = {}): PlaneWorkItem {
  return {
    id: key,
    key,
    sequenceId: Number(key.split('-')[1]),
    title: key,
    url: `https://app.plane.so/work/${key}`,
    project: { id: 'project-1', identifier: 'DEV', name: 'Development' },
    state: { id: 'todo', name: 'To do', group: 'unstarted' },
    labels: [],
    assignees: [],
    priority: 'none',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

describe('Plane work item view', () => {
  const items = [
    item('DEV-10', {
      title: 'Fix import',
      state: { id: 'review', name: 'Review', group: 'started' },
      assignees: [{ id: 'alice', displayName: 'Alice' }],
      priority: 'urgent',
      updatedAt: '2026-01-03T00:00:00Z'
    }),
    item('DEV-2', { title: 'Write docs', priority: 'low', updatedAt: '2026-01-02T00:00:00Z' }),
    item('DEV-1', { title: 'Fix login', updatedAt: '2026-01-01T00:00:00Z' })
  ]

  it('combines search, exact status, assignee, and priority filters', () => {
    const view = {
      ...defaultView,
      search: 'fix',
      stateIds: ['review'],
      assigneeIds: ['alice'],
      priorities: ['urgent']
    }
    expect(selectPlaneWorkItems(items, view).map((entry) => entry.key)).toEqual(['DEV-10'])
    expect(
      selectPlaneWorkItems(items, { ...defaultView, assigneeIds: ['unassigned'] }).length
    ).toBe(2)
  })

  it('combines choices within each facet with OR and facets with AND', () => {
    expect(
      selectPlaneWorkItems(items, {
        ...defaultView,
        stateIds: ['review', 'todo'],
        assigneeIds: ['alice', 'unassigned'],
        priorities: ['urgent', 'low']
      }).map((item) => item.key)
    ).toEqual(['DEV-10', 'DEV-2'])
  })

  it.each(['10', 'DEV-10', 'dev-10'])('searches the key with %s', (search) => {
    expect(selectPlaneWorkItems(items, { ...defaultView, search }).map((item) => item.key)).toEqual(
      ['DEV-10']
    )
  })

  it('sorts numeric keys and priority without mutating the fetched list', () => {
    expect(
      selectPlaneWorkItems(items, { ...defaultView, sortField: 'key', sortDirection: 'asc' }).map(
        (entry) => entry.key
      )
    ).toEqual(['DEV-1', 'DEV-2', 'DEV-10'])
    expect(
      selectPlaneWorkItems(items, { ...defaultView, sortField: 'priority' }).map(
        (entry) => entry.key
      )
    ).toEqual(['DEV-10', 'DEV-2', 'DEV-1'])
    expect(items[0].key).toBe('DEV-10')
  })

  it('requests a matching server order for date sorting', () => {
    expect(planeWorkItemOrderBy(defaultView)).toBe('-updated_at')
    expect(
      planeWorkItemOrderBy({ ...defaultView, sortField: 'created', sortDirection: 'asc' })
    ).toBe('created_at')
    expect(planeWorkItemOrderBy({ ...defaultView, sortField: 'title' })).toBe('-updated_at')
  })
})
