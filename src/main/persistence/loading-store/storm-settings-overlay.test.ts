import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

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

const { Store } = await import('./store')
const { setAppEnvironment } = await import('../../../shared/app-environment')
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('shares sessions while preserving each edition settings across alternating launches', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-storm-profile-'))
  dirs.push(dir)
  const dataFile = join(dir, 'orca-data.json')
  setAppEnvironment({
    getPath: () => dir,
    getAppPath: () => dir,
    getVersion: () => '0.0.0-test',
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })

  const official = new Store({ dataFile, stormSettingsOverlay: false })
  official.updateSettings({ theme: 'light' })
  official.flush()

  const storm = new Store({ dataFile, stormSettingsOverlay: true })
  expect(storm.getSettings().theme).toBe('light')
  storm.updateSettings({ theme: 'dark' })
  storm.setWorkspaceSession({ ...storm.getWorkspaceSession(), activeTabId: 'storm-tab' })
  storm.flush()

  const officialAgain = new Store({ dataFile, stormSettingsOverlay: false })
  expect(officialAgain.getSettings().theme).toBe('light')
  expect(officialAgain.getWorkspaceSession().activeTabId).toBe('storm-tab')
  officialAgain.updateSettings({ theme: 'system' })
  officialAgain.flush()

  const stormAgain = new Store({ dataFile, stormSettingsOverlay: true })
  expect(stormAgain.getSettings().theme).toBe('dark')
  expect(stormAgain.getWorkspaceSession().activeTabId).toBe('storm-tab')
  expect(JSON.parse(readFileSync(dataFile, 'utf-8')).settings.theme).toBe('system')
  expect(JSON.parse(readFileSync(join(dir, 'orca-storm-settings.json'), 'utf-8')).theme).toBe(
    'dark'
  )
  stormAgain.freezeWrites()
})
