import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeFileDurableSync } from '../../durable-file-write'

export function stormSettingsPath(dataFile: string): string {
  return join(dirname(dataFile), 'orca-storm-settings.json')
}

export function readStormSettings(dataFile: string): Record<string, unknown> | null {
  const file = stormSettingsPath(dataFile)
  if (!existsSync(file)) {
    return null
  }
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : null
  } catch (error) {
    console.warn('[persistence] Could not read Orca Storm settings:', error)
    return null
  }
}

export function writeStormSettings(dataFile: string, payload: Buffer): void {
  const file = stormSettingsPath(dataFile)
  mkdirSync(dirname(file), { recursive: true })
  writeFileDurableSync(`${file}.tmp`, file, payload)
}
