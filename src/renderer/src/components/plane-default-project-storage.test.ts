// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadPlaneDefaultProjectId,
  resolvePlaneProjectId,
  savePlaneDefaultProjectId
} from './plane-default-project-storage'

describe('Plane default project', () => {
  beforeEach(() => localStorage.clear())

  it('keeps independent defaults per Plane workspace', () => {
    savePlaneDefaultProjectId('workspace-a', 'project-a')
    savePlaneDefaultProjectId('workspace-b', 'project-b')
    expect(loadPlaneDefaultProjectId('workspace-a')).toBe('project-a')
    expect(loadPlaneDefaultProjectId('workspace-b')).toBe('project-b')
    savePlaneDefaultProjectId('workspace-a', null)
    expect(loadPlaneDefaultProjectId('workspace-a')).toBeNull()
    expect(loadPlaneDefaultProjectId('workspace-b')).toBe('project-b')
  })

  it('opens the saved project and preserves a valid current selection', () => {
    const projects = [
      { id: 'first', identifier: 'F', name: 'First' },
      { id: 'preferred', identifier: 'P', name: 'Preferred' }
    ]
    savePlaneDefaultProjectId('workspace-a', 'preferred')
    expect(resolvePlaneProjectId(projects, '', 'workspace-a')).toBe('preferred')
    expect(resolvePlaneProjectId(projects, 'first', 'workspace-a')).toBe('first')
    expect(resolvePlaneProjectId(projects.slice(0, 1), '', 'workspace-a')).toBe('first')
  })
})
