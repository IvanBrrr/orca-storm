export type TelegramIntegrationStatus = {
  configured: boolean
  connected: boolean
  bot: { id: number; username: string; topicsEnabled: boolean } | null
  ownerId: number | null
  notificationsEnabled: boolean
  pairingUrl: string | null
  topicCount: number
  error: string | null
}

export type TelegramIntegrationApi = {
  status: () => Promise<TelegramIntegrationStatus>
  configure: (args: { token: string }) => Promise<TelegramIntegrationStatus>
  pair: () => Promise<TelegramIntegrationStatus>
  setNotifications: (args: { enabled: boolean }) => Promise<TelegramIntegrationStatus>
  disconnect: () => Promise<TelegramIntegrationStatus>
}
