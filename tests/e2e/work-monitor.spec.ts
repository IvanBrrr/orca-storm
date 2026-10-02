import { test, expect } from './helpers/orca-app'
import type { GitHubWorkItem } from '../../src/shared/github/work-item-types'
import type { PlaneWorkItem } from '../../src/shared/plane-types'

test('work monitor renders personal turns, linked details and team queues', async ({
  electronApp,
  orcaPage,
  seededRepoPath
}, testInfo) => {
  const updatedAt = new Date().toISOString()
  const project = {
    id: 'monitor-project',
    identifier: 'DEV',
    name: 'Development',
    workspaceId: 'plane-workspace'
  }
  const tasks: PlaneWorkItem[] = [42, 43, 44].map((number) => ({
    id: `task-${number}`,
    key: `DEV-${number}`,
    sequenceId: number,
    title:
      number === 42
        ? 'Reconnect reliably'
        : number === 43
          ? 'Improve task search'
          : 'Finish reconnect rollout',
    url: `https://plane.example/acme/DEV-${number}`,
    project,
    state: { id: 'started', name: 'In progress', group: 'started' },
    assignees: [{ id: 'plane-alice', displayName: 'Alice' }],
    labels: [],
    priority: 'high',
    createdAt: updatedAt,
    updatedAt
  }))
  const prs: GitHubWorkItem[] = [12, 13, 14, 15, 16].map((number) => ({
    id: `pr-${number}`,
    type: 'pr',
    number,
    title:
      number === 12
        ? 'DEV-42 Reconnect reliably'
        : number === 13
          ? 'Review terminal rendering'
          : number === 14
            ? 'Waiting on sidebar review'
            : number === 15
              ? 'DEV-44 Finish reconnect rollout'
              : 'Unconfirmed provider state',
    state: number === 15 ? 'merged' : 'open',
    url: `https://github.com/acme/orca/pull/${number}`,
    labels: [],
    updatedAt,
    author: number === 13 ? 'bob' : 'alice',
    repoId: 'monitor-repo',
    reviewDecision:
      number === 12 ? 'CHANGES_REQUESTED' : number === 16 ? undefined : 'REVIEW_REQUIRED',
    reviewRequests:
      number === 13
        ? [{ login: 'alice', name: null, avatarUrl: '' }]
        : number === 14
          ? [{ login: 'bob', name: null, avatarUrl: '' }]
          : [],
    checksSummary: { state: 'success', total: 1, passed: 1, failed: 0, pending: 0, neutral: 0 }
  }))
  await electronApp.evaluate(
    ({ ipcMain }, { prs, tasks, project }) => {
      for (const channel of [
        'gh:viewer',
        'gh:workItem',
        'plane:status',
        'plane:testConnection',
        'plane:listProjects',
        'plane:listWorkItems'
      ]) {
        ipcMain.removeHandler(channel)
      }
      ipcMain.handle('gh:viewer', () => ({ login: 'alice' }))
      ipcMain.handle(
        'gh:workItem',
        (_event, args: { number: number }) => prs.find((pr) => pr.number === args.number) ?? null
      )
      ipcMain.handle('plane:status', () => ({
        connected: true,
        viewer: { id: 'plane-workspace', displayName: 'Workspace', email: null },
        activeWorkspaceId: 'plane-workspace',
        selectedWorkspaceId: 'plane-workspace'
      }))
      ipcMain.handle('plane:testConnection', () => ({
        ok: true,
        viewer: { id: 'plane-alice', displayName: 'Alice', email: null }
      }))
      ipcMain.handle('plane:listProjects', () => [project])
      ipcMain.handle('plane:listWorkItems', () => ({ items: tasks, truncated: false }))
    },
    { prs, tasks, project }
  )
  await orcaPage.evaluate(
    async ({ prs, repoPath, updatedAt }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Build with --mode e2e')
      }
      const repo = store.getState().repos.find((candidate) => candidate.path === repoPath)
      if (!repo) {
        throw new Error('Seeded repository is unavailable')
      }
      await store.getState().updateRepo(repo.id, { upstream: { owner: 'acme', repo: 'orca' } })
      const items = prs.map((pr) => ({ ...pr, repoId: repo.id }))
      store.setState({
        fetchWorkItemsAcrossRepos: async (_repos, _issues, _prs, search) => ({
          items: items.filter((pr) =>
            search?.includes('is:merged') ? pr.state === 'merged' : pr.state === 'open'
          ),
          failedCount: 0,
          githubUnavailable: false
        }),
        fetchPRComments: async () => [
          {
            id: 1,
            author: 'bob',
            authorAvatarUrl: '',
            body: 'Please keep the reconnect retry bounded.',
            createdAt: updatedAt,
            url: 'https://github.com/acme/orca/pull/12#discussion_r1',
            threadId: 'thread-1',
            isResolved: false
          }
        ]
      })
      store.getState().openTaskPage()
    },
    { prs, repoPath: seededRepoPath, updatedAt }
  )

  const authorLane = orcaPage
    .locator('section')
    .filter({ has: orcaPage.getByRole('heading', { name: /^My turn as author/ }) })
  await expect(authorLane.getByRole('button', { name: /Reconnect reliably/ })).toBeVisible()
  const reviewerLane = orcaPage
    .locator('section')
    .filter({ has: orcaPage.getByRole('heading', { name: /^My turn as reviewer/ }) })
  await expect(
    reviewerLane.getByRole('button', { name: /Review terminal rendering/ })
  ).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: /Improve task search/ })).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: /Waiting on sidebar review/ })).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: /Finish reconnect rollout/ })).toBeVisible()
  await expect(orcaPage.getByRole('button', { name: /Unconfirmed provider state/ })).toBeVisible()
  await expect(orcaPage.getByRole('alert')).toHaveCount(0)
  const hidden = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().every((window) => !window.isVisible())
  )
  expect(hidden).toBe(true)
  await orcaPage.screenshot({
    path: testInfo.outputPath('work-monitor-attention.png'),
    animations: 'disabled'
  })

  await authorLane.getByRole('button', { name: /Reconnect reliably/ }).click({ force: true })
  const detail = orcaPage.getByRole('dialog')
  await expect(detail.getByText('CHANGES_REQUESTED', { exact: true })).toBeVisible()
  await expect(detail.getByText('DEV-42 · Plane', { exact: true })).toBeVisible()
  await expect(detail.getByText('Please keep the reconnect retry bounded.')).toBeVisible()
  await expect(detail.getByText(/1 unresolved threads found.*total is unknown/)).toBeVisible()
  await orcaPage.screenshot({
    path: testInfo.outputPath('work-monitor-detail.png'),
    animations: 'disabled'
  })
  await detail.getByRole('button', { name: 'Close', exact: true }).click({ force: true })

  await orcaPage.getByRole('tab', { name: 'Team', exact: true }).click({ force: true })
  const table = orcaPage.getByRole('table')
  await expect(table.getByRole('columnheader', { name: 'Requested reviews' })).toBeVisible()
  const aliceRow = table
    .getByRole('row')
    .filter({ has: orcaPage.getByRole('button', { name: 'alice', exact: true }) })
  await expect(aliceRow.getByRole('cell')).toHaveText(['aliceGitHub', '0', '3', '1', '1'])
  await table.getByRole('button', { name: 'bob', exact: true }).click({ force: true })
  await expect(orcaPage.getByRole('button', { name: /Review terminal rendering/ })).toBeVisible()
  await orcaPage.screenshot({
    path: testInfo.outputPath('work-monitor-team.png'),
    animations: 'disabled'
  })
})
