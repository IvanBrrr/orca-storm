import React from 'react'
import { createRoot } from 'react-dom/client'
import { TelegramIntegrationCard } from '../../../src/renderer/src/components/settings/TelegramIntegrationCard'
import type {
  TelegramIntegrationApi,
  TelegramIntegrationStatus
} from '../../../src/shared/telegram-integration'
import './fixture.css'

const params = new URLSearchParams(window.location.search)
document.documentElement.classList.toggle('dark', params.get('theme') === 'dark')
const connected = params.get('state') !== 'empty'
const topics = params.get('state') !== 'topics-disabled'
let status: TelegramIntegrationStatus = {
  configured: connected,
  connected: connected && topics,
  bot: connected ? { id: 123456789, username: 'personal_orca_bot', topicsEnabled: topics } : null,
  ownerId: connected && topics ? 987654321 : null,
  notificationsEnabled: true,
  pairingUrl: null,
  topicCount: connected ? 12 : 0,
  error: topics ? null : 'Включи Threaded Mode для бота в настройках BotFather.'
}
const api: TelegramIntegrationApi = {
  status: async () => status,
  configure: async () => status,
  pair: async () => status,
  disconnect: async () => {
    status = { ...status, configured: false, connected: false, bot: null, ownerId: null }
    return status
  },
  setNotifications: async ({ enabled }) => {
    status = { ...status, notificationsEnabled: enabled }
    return status
  }
}
Object.defineProperty(window, 'api', {
  value: { telegram: api, shell: { openUrl: async () => {} } }
})
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <main className="min-h-screen bg-background p-5 text-foreground">
      <TelegramIntegrationCard />
    </main>
  )
}
