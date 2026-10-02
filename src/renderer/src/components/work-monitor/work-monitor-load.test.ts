import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import type { PlaneProject, PlaneWorkItem } from '../../../../shared/plane-types'
import { loadMonitorSnapshot } from './work-monitor-load'

const { fetchAcross, listProjects, listItems } = vi.hoisted(() => ({
  fetchAcross: vi.fn(),
  listProjects: vi.fn(),
  listItems: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ fetchWorkItemsAcrossRepos: fetchAcross }) }
}))
vi.mock('@/runtime/runtime-plane-client', () => ({
  planeListProjects: listProjects,
  planeListWorkItems: listItems
}))

const repo: Repo = {
  id: 'remote',
  path: '/same/path',
  displayName: 'Orca',
  badgeColor: '',
  addedAt: 0,
  connectionId: 'ssh-1',
  upstream: { owner: 'acme', repo: 'orca' }
}
const projects: PlaneProject[] = Array.from({ length: 5 }, (_, i) => ({
  id: `project-${i}`,
  identifier: `DEV${i}`,
  name: `Project ${i}`,
  workspaceId: `workspace-${i}`
}))
const task: PlaneWorkItem = {
  id: 'task',
  key: 'DEV0-1',
  sequenceId: 1,
  title: 'Task',
  url: 'https://plane.example/task',
  project: projects[0],
  state: { id: 'started', name: 'In progress', group: 'started' },
  labels: [],
  assignees: [],
  priority: 'none',
  createdAt: '',
  updatedAt: ''
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchAcross.mockResolvedValue({ items: [], failedCount: 0, githubUnavailable: false })
  listProjects.mockResolvedValue(projects)
  listItems.mockResolvedValue({ items: [], truncated: false })
})

describe('monitor snapshot loading', () => {
  it('uses existing host-scoped GitHub reads and a bounded recent-merge query', async () => {
    await loadMonitorSnapshot([repo], null, { connected: false, viewer: null }, 'all')
    expect(fetchAcross).toHaveBeenCalledTimes(2)
    expect(fetchAcross).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          repoId: 'remote',
          path: '/same/path',
          sourceContext: expect.objectContaining({ hostId: 'ssh:ssh-1', provider: 'github' })
        })
      ],
      100,
      100,
      'is:pr is:open',
      { force: true, noCache: true, requireComplete: true, allowStaleFallback: false }
    )
    expect(fetchAcross.mock.calls[1][3]).toMatch(/^is:pr is:merged updated:>=\d{4}-\d{2}-\d{2}$/)
    expect(listProjects).not.toHaveBeenCalled()
  })

  it('routes every Plane project to its workspace with at most three active reads', async () => {
    let active = 0
    let peak = 0
    listItems.mockImplementation(async () => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return { items: [], truncated: false }
    })
    const settings = { activeRuntimeEnvironmentId: 'remote-runtime' }
    await loadMonitorSnapshot(
      [],
      settings,
      { connected: true, viewer: null, selectedWorkspaceId: 'all' },
      'all'
    )
    expect(peak).toBe(3)
    expect(listProjects).toHaveBeenCalledWith(settings, { workspaceId: 'all' })
    projects.forEach((project) =>
      expect(listItems).toHaveBeenCalledWith(settings, {
        project,
        workspaceId: project.workspaceId,
        limit: 250,
        orderBy: '-updated_at'
      })
    )
  })

  it('keeps successful sources and reports failed or truncated projects', async () => {
    fetchAcross.mockResolvedValue({
      items: [],
      failedCount: 1,
      requestFailureCount: 1,
      githubUnavailable: true
    })
    listProjects.mockResolvedValue(projects.slice(0, 2))
    listItems
      .mockResolvedValueOnce({ items: [task], truncated: true })
      .mockRejectedValueOnce(new Error('Host disconnected'))
    const result = await loadMonitorSnapshot([repo], null, { connected: true, viewer: null }, 'all')
    expect(result.plane).toEqual([task])
    expect(result.limited).toBe(true)
    expect(result.errors).toContain('Plane · Project 1: Host disconnected')
    expect(result.errors.some((message) => message.startsWith('GitHub:'))).toBe(true)
    expect(result.fetchedAt).toBeTruthy()
  })

  it('does not fetch unrelated projects when a project is selected', async () => {
    await loadMonitorSnapshot([], null, { connected: true, viewer: null }, 'project-3')
    expect(listItems).toHaveBeenCalledTimes(1)
    expect(listItems.mock.calls[0][1].project.id).toBe('project-3')
  })
})
