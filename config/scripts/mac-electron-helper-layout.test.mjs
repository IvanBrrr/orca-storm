import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import helperLayout from './mac-electron-helper-layout.cjs'

const { restoreMacElectronHelperLayout } = helperLayout
const suffixes = ['', ' (GPU)', ' (Plugin)', ' (Renderer)']

describe.skipIf(process.platform !== 'darwin')('macOS Electron helper layout', () => {
  it('restores the helper names required by Electron before signing', () => {
    const root = mkdtempSync(join(tmpdir(), 'storca-helper-layout-'))
    const appBundle = join(root, 'Storca.app')
    const frameworks = join(appBundle, 'Contents', 'Frameworks')
    try {
      for (const suffix of suffixes) {
        const name = `Storca Helper${suffix}`
        const contents = join(frameworks, `${name}.app`, 'Contents')
        mkdirSync(join(contents, 'MacOS'), { recursive: true })
        writeFileSync(join(contents, 'MacOS', name), 'helper')
        writeFileSync(
          join(contents, 'Info.plist'),
          `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${name}</string></dict></plist>`
        )
      }

      restoreMacElectronHelperLayout(appBundle, 'Storca')

      for (const suffix of suffixes) {
        const name = `Electron Helper${suffix}`
        const contents = join(frameworks, `${name}.app`, 'Contents')
        expect(existsSync(join(contents, 'MacOS', name))).toBe(true)
        expect(readFileSync(join(contents, 'MacOS', name), 'utf8')).toBe('helper')
        expect(
          execFileSync(
            '/usr/libexec/PlistBuddy',
            ['-c', 'Print :CFBundleExecutable', join(contents, 'Info.plist')],
            {
              encoding: 'utf8'
            }
          ).trim()
        ).toBe(name)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
