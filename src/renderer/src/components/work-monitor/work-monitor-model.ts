import type { GitHubWorkItem } from '../../../../shared/github/work-item-types'
import type { PlaneWorkItem } from '../../../../shared/plane-types'

export type MonitorLane = 'author' | 'reviewer' | 'waiting' | 'working' | 'finish' | 'unknown'
export type MonitorReason =
  | 'changes'
  | 'checks'
  | 'conflict'
  | 'review'
  | 'draft'
  | 'merge'
  | 'close'
  | 'working'
  | 'assigned'
  | 'noReviewer'
  | 'mergeBlocked'
  | 'unknown'
export type MonitorPerson = { id: string; name: string; host?: string }
export type MonitorAction = {
  lane: MonitorLane
  reason: MonitorReason
  person: MonitorPerson | null
  prUrl?: string
}
export type MonitorRow = {
  id: string
  title: string
  plane: PlaneWorkItem | null
  prs: GitHubWorkItem[]
  actions: MonitorAction[]
  updatedAt: string
  participants: MonitorPerson[]
}
export type MonitorIdentity = {
  githubAccounts: Readonly<Record<string, { host: string; login: string }>>
  planeViewerIds: Readonly<Record<string, string>>
}

export function githubPerson(login: string, host = 'github.com'): MonitorPerson {
  const scope = host.toLowerCase() === 'github.com' ? '' : `${host.toLowerCase()}:`
  return { id: `github:${scope}${login.toLowerCase()}`, name: login, ...(scope ? { host } : {}) }
}

export function monitorPRPerson(pr: GitHubWorkItem): MonitorPerson | null {
  return pr.author ? githubPerson(pr.author, pr.prRepo?.host) : null
}

function planePerson(item: PlaneWorkItem, id: string, name: string): MonitorPerson {
  const workspaceId = item.workspaceId ?? item.project.workspaceId ?? ''
  return { id: `plane:${workspaceId}:${id}`, name }
}

function prActions(pr: GitHubWorkItem): MonitorAction[] {
  const author = monitorPRPerson(pr)
  if (pr.state === 'merged') {
    return [{ lane: 'finish', reason: 'close', person: author }]
  }
  if (pr.state === 'closed') {
    return []
  }
  if (pr.state === 'draft') {
    return [{ lane: 'working', reason: 'draft', person: author }]
  }
  const actions: MonitorAction[] = []
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    actions.push({ lane: 'author', reason: 'changes', person: author })
  }
  if (pr.checksSummary?.state === 'failure') {
    actions.push({ lane: 'author', reason: 'checks', person: author })
  }
  if (pr.mergeable === 'CONFLICTING') {
    actions.push({ lane: 'author', reason: 'conflict', person: author })
  }
  for (const reviewer of pr.reviewRequests ?? []) {
    actions.push({
      lane: 'reviewer',
      reason: 'review',
      person: githubPerson(reviewer.login, pr.prRepo?.host)
    })
  }
  if (pr.reviewDecision === 'APPROVED') {
    const ready =
      pr.mergeQueueRequired !== true &&
      pr.mergeable === 'MERGEABLE' &&
      pr.mergeStateStatus === 'CLEAN' &&
      (pr.checksSummary?.state === 'success' || pr.checksSummary?.state === 'none')
    if (!actions.some((action) => action.lane === 'author')) {
      actions.push({
        lane: ready ? 'finish' : 'waiting',
        reason: ready ? 'merge' : 'mergeBlocked',
        person: author
      })
    }
  } else if (!actions.length) {
    actions.push({
      lane: 'unknown',
      reason: pr.reviewRequests ? 'noReviewer' : 'unknown',
      person: author
    })
  }
  return actions
}

function keyReferences(pr: GitHubWorkItem): Set<string> {
  const text = `${pr.title} ${pr.branchName ?? ''}`
  return new Set(
    [...text.matchAll(/(?:^|[^a-z0-9])([a-z][a-z0-9]*-\d+)(?=$|[^a-z0-9])/gi)].map((match) =>
      match[1].toUpperCase()
    )
  )
}

export function buildMonitorRows(
  github: readonly GitHubWorkItem[],
  plane: readonly PlaneWorkItem[]
): MonitorRow[] {
  const rows = new Map<string, MonitorRow>()
  const byKey = new Map<string, PlaneWorkItem[]>()
  for (const item of plane) {
    const key = item.key.toUpperCase()
    byKey.set(key, [...(byKey.get(key) ?? []), item])
  }
  const uniquePRs = new Map(github.filter((item) => item.type === 'pr').map((pr) => [pr.url, pr]))
  for (const pr of uniquePRs.values()) {
    const keys = [...keyReferences(pr)]
    const references = keys.length === 1 ? (byKey.get(keys[0]) ?? []) : []
    // Ambiguous references must not combine tasks from different projects or workspaces.
    const task = references.length === 1 ? references[0] : null
    if (
      pr.state === 'merged' &&
      (!task || task.state.group === 'completed' || task.state.group === 'cancelled')
    ) {
      continue
    }
    if (pr.state === 'closed') {
      continue
    }
    const id = task ? `plane:${task.url}` : `github:${pr.url}`
    const row = rows.get(id) ?? {
      id,
      title: task?.title ?? pr.title,
      plane: task,
      prs: [],
      actions: [],
      updatedAt: task?.updatedAt ?? pr.updatedAt,
      participants: []
    }
    row.prs.push(pr)
    row.actions.push(...prActions(pr).map((action) => ({ ...action, prUrl: pr.url })))
    if (pr.updatedAt > row.updatedAt) {
      row.updatedAt = pr.updatedAt
    }
    if (pr.author) {
      row.participants.push(githubPerson(pr.author, pr.prRepo?.host))
    }
    rows.set(id, row)
  }
  for (const item of plane) {
    const id = `plane:${item.url}`
    const row = rows.get(id)
    const assignees = item.assignees.map((member) =>
      planePerson(item, member.id, member.displayName)
    )
    if (row) {
      row.participants.push(...assignees)
      const hasOpenPR = row.prs.some((pr) => pr.state === 'open' || pr.state === 'draft')
      if (hasOpenPR) {
        row.actions = row.actions.filter((action) => action.reason !== 'close')
      } else if (assignees.length) {
        row.actions = assignees.map((person) => ({ lane: 'finish', reason: 'close', person }))
      }
    } else if (item.state.group === 'started') {
      rows.set(id, {
        id,
        title: item.title,
        plane: item,
        prs: [],
        updatedAt: item.updatedAt,
        participants: assignees,
        actions: assignees.length
          ? assignees.map((person) => ({ lane: 'working', reason: 'working', person }))
          : [{ lane: 'unknown', reason: 'working', person: null }]
      })
    }
  }
  for (const row of rows.values()) {
    row.participants = [
      ...new Map(
        [...row.participants, ...row.actions.flatMap((a) => (a.person ? [a.person] : []))].map(
          (person) => [person.id, person]
        )
      ).values()
    ]
  }
  return [...rows.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}

export function personalMonitorLane(
  row: MonitorRow,
  identity: MonitorIdentity,
  lane: MonitorLane
): boolean {
  const planeWorkspace = row.plane?.workspaceId ?? row.plane?.project.workspaceId ?? ''
  const planeViewer = identity.planeViewerIds[planeWorkspace]
  const minePlane = planeViewer ? `plane:${planeWorkspace}:${planeViewer}` : null
  const minePR = (pr: GitHubWorkItem, person: MonitorPerson | null): boolean => {
    const account = identity.githubAccounts[pr.repoId]
    return Boolean(
      account?.login &&
      account.host.toLowerCase() === (pr.prRepo?.host ?? 'github.com').toLowerCase() &&
      person?.id === githubPerson(account.login, account.host).id
    )
  }
  const mineAction = (action: MonitorAction): boolean => {
    if (!action.person) {
      return false
    }
    if (action.person.id === minePlane) {
      return true
    }
    const pr = row.prs.find((item) => item.url === action.prUrl)
    return Boolean(pr && minePR(pr, action.person))
  }
  if (lane === 'waiting') {
    return (
      (row.participants.some((p) => p.id === minePlane) ||
        row.prs.some((pr) => minePR(pr, monitorPRPerson(pr)))) &&
      row.actions.some((a) => a.lane === 'waiting' || (a.person && !mineAction(a))) &&
      !row.actions.some((a) => mineAction(a) && a.lane !== 'waiting' && a.lane !== 'unknown')
    )
  }
  return row.actions.some((a) => a.lane === lane && mineAction(a))
}

export function monitorPeople(rows: readonly MonitorRow[]): MonitorPerson[] {
  return [...new Map(rows.flatMap((row) => row.participants).map((p) => [p.id, p])).values()].sort(
    (a, b) => a.name.localeCompare(b.name)
  )
}
