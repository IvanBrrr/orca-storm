import { _electron as electron, expect } from '@stablyai/playwright-test'
import { build as buildMain } from 'esbuild'
import { build as buildRenderer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { oggOpusSilence } from './opus-fixture.mjs'

if (process.env.ORCA_BACKGROUND_LAUNCH !== '1') {
  throw new Error('Requires ORCA_BACKGROUND_LAUNCH=1')
}
const root = path.resolve(import.meta.dirname, '../../..')
mkdirSync(path.join(root, '.bench-fixtures'), { recursive: true })
const output = mkdtempSync(path.join(root, '.bench-fixtures/telegram-settings-'))
const main = path.join(output, 'main.cjs')
const voice = path.join(output, 'voice.cjs')
await buildMain({
  entryPoints: [path.join(root, 'tests/tools/benchmarks/spinner-rendering/main.ts')],
  outfile: main,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron']
})
await buildMain({
  entryPoints: [path.join(root, 'src/main/telegram/telegram-voice-transcription.ts')],
  outfile: voice,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron']
})
appendFileSync(
  main,
  `\nglobalThis.__orcaTelegramVoiceDecode = require(${JSON.stringify(voice)}).decodeTelegramVoice;\n`
)
await buildRenderer({
  configFile: false,
  root: import.meta.dirname,
  base: './',
  logLevel: 'silent',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.join(root, 'src/renderer/src') } },
  build: { outDir: path.join(output, 'renderer'), emptyOutDir: true }
})
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = process.env
const app = await electron.launch({ args: [main], env: { ...env, ORCA_BACKGROUND_LAUNCH: '1' } })
const report = {
  scope:
    'Production Telegram settings and canonical CSS in hidden Electron; Telegram API is supplied by the fixture.',
  screenshots: [],
  windows: []
}
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  for (const width of [420, 900]) {
    await page.setViewportSize({ width, height: 950 })
    for (const theme of ['light', 'dark']) {
      for (const state of ['empty', 'connected', 'topics-disabled']) {
        const url = pathToFileURL(path.join(output, 'renderer/index.html'))
        url.searchParams.set('theme', theme)
        url.searchParams.set('state', state)
        await page.goto(url.href)
        await expect(page.getByLabel('Bot token')).toBeVisible()
        if (state === 'connected') {
          await expect(page.getByLabel('Telegram bot ID')).toHaveValue('123456789')
          await expect(page.getByText('@personal_orca_bot')).toBeVisible()
        }
        if (state === 'topics-disabled') {
          await expect(page.getByRole('alert')).toBeVisible()
        }
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        )
        expect(overflow).toBe(false)
        const cdp = await page.context().newCDPSession(page)
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
        const name = `${width}-${theme}-${state}.png`
        writeFileSync(path.join(output, name), Buffer.from(data, 'base64'))
        report.screenshots.push(name)
        await cdp.detach()
      }
    }
  }
  expect(errors).toEqual([])
  report.voice = await app.evaluate(
    async (_electron, args) => {
      const decode = globalThis.__orcaTelegramVoiceDecode
      const audio = await decode(Buffer.from(args.bytes, 'base64'), new AbortController().signal)
      let corruptRejected = false
      try {
        await decode(Buffer.from('not audio'), new AbortController().signal)
      } catch {
        corruptRejected = true
      }
      return {
        pcmBytes: audio.chunks.reduce(
          (length, chunk) => length + Buffer.from(chunk, 'base64').length,
          0
        ),
        corruptRejected
      }
    },
    { bytes: oggOpusSilence().toString('base64') }
  )
  expect(report.voice.pcmBytes).toBeGreaterThan(30000)
  expect(report.voice.pcmBytes).toBeLessThan(33000)
  expect(report.voice.corruptRejected).toBe(true)
  report.windows = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => ({
      visible: window.isVisible(),
      focused: window.isFocused()
    }))
  )
  expect(report.windows.every((window) => !window.visible && !window.focused)).toBe(true)
} finally {
  writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`Telegram settings evidence: ${output}`)
  await app.close()
}
