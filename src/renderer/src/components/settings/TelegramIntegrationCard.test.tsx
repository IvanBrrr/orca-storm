// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type {
  TelegramIntegrationApi,
  TelegramIntegrationStatus
} from '../../../../shared/telegram-integration'
import { TelegramIntegrationCard } from './TelegramIntegrationCard'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function fixture(initial: TelegramIntegrationStatus) {
  const configure = vi.fn<TelegramIntegrationApi['configure']>(async () => ({
    ...initial,
    configured: true
  }))
  const api: TelegramIntegrationApi = {
    status: async () => initial,
    configure,
    pair: async () => ({ ...initial, pairingUrl: 'https://t.me/personal_bot?start=nonce' }),
    setNotifications: async ({ enabled }) => ({ ...initial, notificationsEnabled: enabled }),
    disconnect: async () => ({ ...initial, configured: false, bot: null, ownerId: null })
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { telegram: api, shell: { openUrl: vi.fn() } }
  })
  return { configure, ...render(<TelegramIntegrationCard />) }
}

const disconnected: TelegramIntegrationStatus = {
  configured: false,
  connected: false,
  bot: null,
  ownerId: null,
  notificationsEnabled: true,
  pairingUrl: null,
  topicCount: 0,
  error: null
}

it('masks a token, sends it only on submit, and clears it after successful storage', async () => {
  const h = fixture(disconnected)
  const input = await h.findByLabelText('Bot token')
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('token input missing')
  }
  expect(input.type).toBe('password')
  fireEvent.change(input, { target: { value: '12345:private-token' } })
  expect(h.configure).not.toHaveBeenCalled()
  fireEvent.click(h.getByRole('button', { name: 'Connect bot' }))
  await vi.waitFor(() =>
    expect(h.configure).toHaveBeenCalledExactlyOnceWith({ token: '12345:private-token' })
  )
  await vi.waitFor(() => expect(input.value).toBe(''))
})

it('shows the verified bot ID and disables pairing while topics are unavailable', async () => {
  const h = fixture({
    ...disconnected,
    configured: true,
    bot: { id: 12345, username: 'personal_bot', topicsEnabled: false }
  })
  const id = await h.findByLabelText('Telegram bot ID')
  if (!(id instanceof HTMLInputElement)) {
    throw new Error('ID input missing')
  }
  expect(id.value).toBe('12345')
  expect(id.readOnly).toBe(true)
  const pair = h.getByRole('button', { name: 'Link my Telegram account' })
  if (!(pair instanceof HTMLButtonElement)) {
    throw new Error('pair button missing')
  }
  expect(pair.disabled).toBe(true)
  expect(h.getByText('@personal_bot')).toBeDefined()
})
