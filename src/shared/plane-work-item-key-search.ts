import { PLANE_WORK_ITEM_KEY_PATTERN } from './plane-work-item-url'

export function parsePlaneWorkItemKey(
  key: string
): { projectIdentifier: string; sequenceId: number } | null {
  const trimmed = key.trim()
  if (!PLANE_WORK_ITEM_KEY_PATTERN.test(trimmed)) {
    return null
  }
  const separator = trimmed.lastIndexOf('-')
  const sequenceId = Number.parseInt(trimmed.slice(separator + 1), 10)
  if (!Number.isSafeInteger(sequenceId) || sequenceId <= 0) {
    return null
  }
  return { projectIdentifier: trimmed.slice(0, separator).toUpperCase(), sequenceId }
}

export function planeWorkItemSearchKey(search: string, projectIdentifier: string): string | null {
  const value = search.trim()
  if (/^\d+$/.test(value)) {
    const key = `${projectIdentifier}-${value}`
    return parsePlaneWorkItemKey(key) ? key : null
  }
  return parsePlaneWorkItemKey(value) ? value.toUpperCase() : null
}
