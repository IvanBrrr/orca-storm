import { useEffect, useState } from 'react'
import type { PlaneLabel, PlaneMember, PlaneState } from '../../../shared/plane-types'
import {
  planeListLabels,
  planeListMembers,
  planeListStates,
  type RuntimePlaneSettings
} from '@/runtime/runtime-plane-client'

export function usePlaneTaskMetadata(
  settings: RuntimePlaneSettings,
  workspaceId: string,
  projectId: string
): { states: PlaneState[]; members: PlaneMember[]; labels: PlaneLabel[] } {
  const [states, setStates] = useState<PlaneState[]>([])
  const [members, setMembers] = useState<PlaneMember[]>([])
  const [labels, setLabels] = useState<PlaneLabel[]>([])

  useEffect(() => {
    let cancelled = false
    void planeListMembers(settings, { workspaceId })
      .then((next) => {
        if (!cancelled) {
          setMembers(next)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [settings, workspaceId])

  useEffect(() => {
    setStates([])
    setLabels([])
    if (!projectId) {
      return
    }
    let cancelled = false
    void planeListStates(settings, { projectId, workspaceId })
      .then((next) => {
        if (!cancelled) {
          setStates(next)
        }
      })
      .catch(() => {})
    void planeListLabels(settings, { projectId, workspaceId })
      .then((next) => {
        if (!cancelled) {
          setLabels(next)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [settings, projectId, workspaceId])

  return { states, members, labels }
}
