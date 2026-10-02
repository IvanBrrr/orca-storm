import type { Repo } from '../../../../shared/repo-types'
import { getTaskPageRepoSourceContext } from '../task-page-source-context'

export type MonitorAccountScope = {
  key: string
  host: string
  executionHostId: string
  label: string
  repoIds: string[]
}

export function monitorAccountScopes(repos: readonly Repo[]): MonitorAccountScope[] {
  const scopes = new Map<string, MonitorAccountScope>()
  for (const repo of repos) {
    const source = getTaskPageRepoSourceContext(repo, 'github')
    if (source?.providerIdentity?.provider !== 'github') {
      continue
    }
    const host = (source.providerIdentity.host ?? 'github.com').toLowerCase()
    const key = JSON.stringify([source.hostId, host])
    const scope = scopes.get(key) ?? {
      key,
      host,
      executionHostId: source.hostId,
      label: `${host} · ${repo.displayName}`,
      repoIds: []
    }
    scope.repoIds.push(repo.id)
    scopes.set(key, scope)
  }
  return [...scopes.values()]
}
