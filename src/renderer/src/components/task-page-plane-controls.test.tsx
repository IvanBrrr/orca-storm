// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlaneWorkItem } from '../../../shared/plane-types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TaskPagePlaneControls } from './task-page-plane-controls'
import type { PlaneWorkItemView } from './plane-work-item-view'

afterEach(cleanup)

const view: PlaneWorkItemView = {
  search: '',
  stateId: 'all',
  assigneeId: 'all',
  priority: 'all',
  sortField: 'updated',
  sortDirection: 'desc'
}

const item: PlaneWorkItem = {
  id: 'item-1',
  key: 'DEV-12',
  sequenceId: 12,
  title: 'Fix import',
  url: 'https://app.plane.so/acme/browse/DEV-12',
  project: { id: 'project-1', identifier: 'DEV', name: 'Development' },
  state: { id: 'review', name: 'Review', group: 'started' },
  labels: [],
  assignees: [{ id: 'alice', displayName: 'Alice' }],
  priority: 'high',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z'
}

describe('TaskPagePlaneControls', () => {
  it('offers search, status, assignee, priority, and sorting controls', async () => {
    const user = userEvent.setup()
    const onViewChange = vi.fn()
    render(
      <TooltipProvider>
        <TaskPagePlaneControls items={[item]} view={view} onViewChange={onViewChange} />
      </TooltipProvider>
    )

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded work items' }), {
      target: { value: 'DEV-12' }
    })
    expect(onViewChange).toHaveBeenCalledWith({ ...view, search: 'DEV-12' })

    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(screen.getByRole('option', { name: 'Review' }))
    expect(onViewChange).toHaveBeenCalledWith({ ...view, stateId: 'review' })

    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Descending' }))
    expect(onViewChange).toHaveBeenCalledWith({ ...view, sortDirection: 'asc' })
  })
})
