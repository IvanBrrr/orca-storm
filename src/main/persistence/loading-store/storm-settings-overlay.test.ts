import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { profileStateDatabaseFile } from '../profile-state/profile-state-database'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'orca-test',
    getVersion: () => '0.0.0-test',
    isPackaged: false,
    on: () => {},
    whenReady: () => Promise.resolve()
  },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { on: () => {}, handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] }
}))

vi.mock('../../telemetry/client', () => ({ track: () => {} }))
vi.mock('../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: () => ({ nth_repo_added: 2 })
}))
vi.mock('../../ssh/ssh-config-parser', () => ({
  loadUserSshConfig: () => ({ hosts: [] }),
  sshConfigHostsToTargets: () => []
}))

const { createProfileStateStore } = await import('../profile-state/profile-state-store-factory')
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createProfile() {
  const dir = mkdtempSync(join(tmpdir(), 'storca-profile-'))
  dirs.push(dir)
  const options = {
    dataFile: join(dir, 'orca-data.json'),
    databaseFile: profileStateDatabaseFile(dir),
    profileId: 'storca-test'
  }
  function open(stormSettingsOverlay: boolean) {
    return createProfileStateStore({ ...options, stormSettingsOverlay }).store
  }
  return { dir, open }
}

it('shares sessions while preserving each edition settings across alternating launches', () => {
  const { dir, open } = createProfile()
  const official = open(false)
  official.updateSettings({ theme: 'light' })
  official.flush()
  official.freezeWrites()

  const storm = open(true)
  expect(storm.getSettings().theme).toBe('light')
  storm.updateSettings({ theme: 'dark' })
  storm.setWorkspaceSession({ ...storm.getWorkspaceSession(), activeTabId: 'storm-tab' })
  storm.flush()
  storm.freezeWrites()

  const officialAgain = open(false)
  expect(officialAgain.getSettings().theme).toBe('light')
  expect(officialAgain.getWorkspaceSession().activeTabId).toBe('storm-tab')
  officialAgain.updateSettings({ theme: 'system' })
  officialAgain.flush()
  officialAgain.freezeWrites()

  const stormAgain = open(true)
  expect(stormAgain.getSettings().theme).toBe('dark')
  expect(stormAgain.getWorkspaceSession().activeTabId).toBe('storm-tab')
  expect(JSON.parse(readFileSync(join(dir, 'orca-storm-settings.json'), 'utf-8')).theme).toBe(
    'dark'
  )
  stormAgain.freezeWrites()
})

it('shows Plane on a new Storca profile', () => {
  const { open } = createProfile()
  const storm = open(true)
  expect(storm.getSettings().visibleTaskProviders).toContain('plane')
  expect(storm.getSettings().visibleTaskProviders).not.toContain('jira')
  storm.freezeWrites()
})

it('shows Plane in place of Jira without changing shared Orca settings', () => {
  const { open } = createProfile()
  const official = open(false)
  official.updateSettings({
    visibleTaskProviders: ['github', 'gitlab', 'linear', 'jira'],
    defaultTaskSource: 'jira'
  })
  official.flush()
  official.freezeWrites()

  const storm = open(true)
  expect(storm.getSettings().visibleTaskProviders).toEqual(['github', 'gitlab', 'linear', 'plane'])
  expect(storm.getSettings().defaultTaskSource).toBe('plane')
  storm.updateSettings({ visibleTaskProviders: ['github'], defaultTaskSource: 'github' })
  storm.flush()
  storm.freezeWrites()

  const officialAgain = open(false)
  expect(officialAgain.getSettings().visibleTaskProviders).toEqual([
    'github',
    'gitlab',
    'linear',
    'jira'
  ])
  officialAgain.freezeWrites()

  const stormAgain = open(true)
  expect(stormAgain.getSettings().visibleTaskProviders).toEqual(['github'])
  stormAgain.freezeWrites()
})
