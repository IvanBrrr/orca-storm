// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskPageData } from '@/store/slices/ui/ui-slice-contract-core'
import TaskPage from './TaskPage'
import { TooltipProvider } from '@/components/ui/tooltip'

const state = vi.hoisted(() => {
  const initial: {
    taskPageData: TaskPageData
    activeModal: string
    closeTaskPage: ReturnType<typeof vi.fn>
  } = { taskPageData: {}, activeModal: 'none', closeTaskPage: vi.fn() }
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
  state.activeModal = 'none'
  state.closeTaskPage.mockClear()
})
afterEach(cleanup)

describe('work screen navigation', () => {
  it.each(['dialog', 'alertdialog', 'menu', 'listbox'])('leaves Escape to a %s overlay', (role) => {
    render(<TaskPage />, { wrapper: TooltipProvider })
    const overlay = document.createElement('div')
    overlay.setAttribute('role', role)
    Object.defineProperty(overlay, 'getClientRects', { value: () => [new DOMRect(0, 0, 100, 100)] })
    document.body.append(overlay)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(state.closeTaskPage).not.toHaveBeenCalled()
    overlay.remove()
  })
  it('closes each Tasks view through the common close button and Escape', async () => {
    const user = userEvent.setup()
    render(<TaskPage />, { wrapper: TooltipProvider })
    for (const name of ['My attention', 'Team', 'Task list']) {
      await user.click(screen.getByRole('tab', { name }))
      fireEvent.keyDown(document.body, { key: 'Escape' })
      await user.click(screen.getByRole('button', { name: 'Close tasks' }))
    }
    expect(state.closeTaskPage).toHaveBeenCalledTimes(6)
  })

  it('blurs an input on the first Escape and leaves store modals in control', () => {
    const { rerender } = render(<TaskPage />, { wrapper: TooltipProvider })
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(document.activeElement).not.toBe(input)
    expect(state.closeTaskPage).not.toHaveBeenCalled()
    state.activeModal = 'new-workspace-composer'
    rerender(<TaskPage />, { wrapper: TooltipProvider })
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(state.closeTaskPage).not.toHaveBeenCalled()
    input.remove()
  })
  it('opens attention by default and exposes accessible team and task tabs', async () => {
    const user = userEvent.setup()
    render(<TaskPage />, { wrapper: TooltipProvider })
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
    render(<TaskPage />, { wrapper: TooltipProvider })
    expect(screen.getByRole('tab', { name: 'Task list' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Existing task list')).toBeInTheDocument()
  })

  it('opens an externally requested task while the monitor is visible', () => {
    const { rerender } = render(<TaskPage />, { wrapper: TooltipProvider })
    state.taskPageData = { taskSource: 'github', preselectedRepoId: 'repo-1' }
    rerender(<TaskPage />, { wrapper: TooltipProvider })
    expect(screen.getByText('Existing task list')).toBeInTheDocument()
  })
})
