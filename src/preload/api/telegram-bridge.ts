import { ipcRenderer } from 'electron'
import type { TelegramIntegrationApi } from '../../shared/telegram-integration'

export const telegramApi = {
  status: () => ipcRenderer.invoke('telegram:status'),
  configure: (args) => ipcRenderer.invoke('telegram:configure', args),
  pair: () => ipcRenderer.invoke('telegram:pair'),
  setNotifications: (args) => ipcRenderer.invoke('telegram:setNotifications', args),
  disconnect: () => ipcRenderer.invoke('telegram:disconnect')
} satisfies TelegramIntegrationApi
