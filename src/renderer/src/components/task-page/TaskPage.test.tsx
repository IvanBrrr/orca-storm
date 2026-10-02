// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskPageData } from '@/store/slices/ui/ui-slice-contract-core'
import TaskPage from './TaskPage'

const state = vi.hoisted(() => {
  const initial: { taskPageData: TaskPageData } = { taskPageData: {} }
  return initial
})
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof state) => unknown) => selector(state)
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({}) }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, text: string) => text }))
vi.mock('../work-monitor/WorkMonitor', () => ({
  WorkMonitor: ({ view }: { view: string }) => <div>Monitor: {view}</div>
}))
vi.mock('./TaskListPage', () => ({ default: () => <div>Existing task list</div> }))
beforeEach(() => {
  state.taskPageData = {}
})
afterEach(cleanup)

describe('work screen navigation', () => {
  it('opens attention by default and exposes accessible team and task tabs', async () => {
    const user = userEvent.setup()
    render(<TaskPage />)
    expect(screen.getByRole('tabpanel', { name: 'My attention' })).toHaveTextContent(
      'Monitor: attention'
    )
    await user.click(screen.getByRole('tab', { name: 'Team' }))
    expect(screen.getByRole('tabpanel', { name: 'Team' })).toHaveTextContent('Monitor: team')
    await user.click(screen.getByRole('tab', { name: 'Task list' }))
    expect(screen.getByRole('tabpanel', { name: 'Task list' })).toHaveTextContent(
      'Existing task list'
    )
  })

  it('preserves direct provider navigation and repository preselection', () => {
    state.taskPageData = { taskSource: 'plane', preselectedRepoId: 'repo-1' }
    render(<TaskPage />)
    expect(screen.getByRole('tab', { name: 'Task list' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Existing task list')).toBeInTheDocument()
  })

  it('opens an externally requested task while the monitor is visible', () => {
    const { rerender } = render(<TaskPage />)
    state.taskPageData = { taskSource: 'github', preselectedRepoId: 'repo-1' }
    rerender(<TaskPage />)
    expect(screen.getByText('Existing task list')).toBeInTheDocument()
  })
})
