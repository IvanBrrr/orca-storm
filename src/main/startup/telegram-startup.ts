import { ipcMain, powerMonitor } from 'electron'
import { z } from 'zod'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { isTrustedUIRenderer } from '../ipc/ui'
import { readDesktopAwayState } from '../notifications/desktop-away-state'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { TelegramIntegrationService } from '../telegram/telegram-integration-service'
import { TelegramIntegrationState } from '../telegram/telegram-integration-state'
import { TelegramOrcaSessions } from '../telegram/telegram-orca-sessions'
import { transcribeTelegramVoice } from '../telegram/telegram-voice-transcription'

let service: TelegramIntegrationService | null = null
let ready: Promise<void> = Promise.resolve()

export function startTelegramIntegration(runtime: OrcaRuntimeService): void {
  if (service) {
    return
  }
  const integration = new TelegramIntegrationService(
    new TelegramIntegrationState(getProfileUserDataPath()),
    new TelegramOrcaSessions(runtime, (bytes, signal) =>
      transcribeTelegramVoice(runtime, bytes, signal)
    ),
    () => readDesktopAwayState(powerMonitor)
  )
  service = integration
  ready = integration.initialize()
  const trusted = async (event: Electron.IpcMainInvokeEvent) => {
    if (!isTrustedUIRenderer(event.sender) || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Telegram доступен только из настроек Storca.')
    }
    await ready
    return integration
  }
  ipcMain.handle('telegram:status', async (event) => (await trusted(event)).status())
  ipcMain.handle('telegram:configure', async (event, args: unknown) => {
    const handler = await trusted(event)
    const { token } = z
      .object({ token: z.string().max(256) })
      .strict()
      .parse(args)
    return handler.configure(token)
  })
  ipcMain.handle('telegram:pair', async (event) => (await trusted(event)).pair())
  ipcMain.handle('telegram:setNotifications', async (event, args: unknown) => {
    const handler = await trusted(event)
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(args)
    return handler.setNotifications(enabled)
  })
  ipcMain.handle('telegram:disconnect', async (event) => (await trusted(event)).disconnect())
}

export function stopTelegramIntegration(): Promise<void> {
  const shutdown = service?.close() ?? Promise.resolve()
  return Promise.all([ready, shutdown]).then(() => {})
}
