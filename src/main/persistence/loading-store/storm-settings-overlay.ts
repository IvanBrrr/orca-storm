import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  durableWriteTempPath,
  writeFileDurableIfCurrent,
  writeFileDurableSync
} from '../../durable-file-write'

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
    console.warn('[persistence] Could not read Storca settings:', error)
    return null
  }
}

export async function writeStormSettingsIfCurrent(
  dataFile: string,
  payload: Buffer,
  isCurrent: () => boolean
): Promise<boolean> {
  const file = stormSettingsPath(dataFile)
  await mkdir(dirname(file), { recursive: true })
  return writeFileDurableIfCurrent(
    durableWriteTempPath(file),
    file,
    payload.toString('utf-8'),
    isCurrent
  )
}

export function writeStormSettingsSync(dataFile: string, payload: Buffer): void {
  const file = stormSettingsPath(dataFile)
  mkdirSync(dirname(file), { recursive: true })
  writeFileDurableSync(durableWriteTempPath(file), file, payload)
}
