import type { PlaneProject } from '../../../shared/plane-types'

const STORAGE_PREFIX = 'storca.plane.default-project.v1.'
const RECENT_PREFIX = 'storca.plane.recent-project.v1.'

export function loadPlaneDefaultProjectId(workspaceId: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${workspaceId}`)
  } catch {
    return null
  }
}

export function savePlaneDefaultProjectId(workspaceId: string, projectId: string | null): void {
  try {
    const key = `${STORAGE_PREFIX}${workspaceId}`
    if (projectId) {
      localStorage.setItem(key, projectId)
    } else {
      localStorage.removeItem(key)
    }
  } catch {
    // The current selection remains usable when browser storage is unavailable.
  }
}

export function savePlaneRecentProjectId(workspaceId: string, projectId: string): void {
  try {
    localStorage.setItem(`${RECENT_PREFIX}${workspaceId}`, projectId)
  } catch {
    // The selection still works for this visit.
  }
}

export function resolvePlaneProjectId(
  projects: PlaneProject[],
  currentProjectId: string,
  workspaceId: string
): string {
  if (projects.some((project) => project.id === currentProjectId)) {
    return currentProjectId
  }
  try {
    const recent = localStorage.getItem(`${RECENT_PREFIX}${workspaceId}`)
    const selected = projects.find((project) => project.id === recent)
    if (selected) {
      return selected.id
    }
  } catch {
    // Fall back to the preferred project.
  }
  const preferred = loadPlaneDefaultProjectId(workspaceId)
  return projects.find((project) => project.id === preferred)?.id ?? projects[0]?.id ?? ''
}
