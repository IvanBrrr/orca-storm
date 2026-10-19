import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { setSecretStore } from '../../shared/secret-store'
import { TelegramIntegrationState } from './telegram-integration-state'
import { TelegramSessionContext } from './telegram-session-context'
import { telegramTestFixture } from './telegram-test-fixture'

it('persists encrypted credentials without exposing them as configuration data', async () => {
  const h = await telegramTestFixture()
  h.state.setToken('12345:super-private-token')
  await h.state.save()
  const content = await readFile(join(h.root, 'telegram-integration.json'), 'utf8')
  expect(content).not.toContain('super-private-token')
  const restored = new TelegramIntegrationState(h.root)
  try {
    await restored.load()
    expect(restored.token()).toBe('12345:super-private-token')
  } finally {
    restored.writer.close()
  }
})

it('refuses to store a new token when platform encryption is unavailable', async () => {
  const h = await telegramTestFixture()
  setSecretStore({ ...h.secrets, isEncryptionAvailable: () => false })
  expect(() => h.state.setToken('private-token')).toThrow('Токен не сохранён')
  expect(h.state.data.encryptedToken).toBe('')
})

it('keeps operation identities and consumed actions across a process restart', async () => {
  const h = await telegramTestFixture()
  h.ctx.request('session-1')
  const operationId = await h.ctx.operation(123)
  const key = h.state.action({ kind: 'discard' }, 101)
  h.state.data.actions[key]!.used = true
  h.state.data.offset = 124
  await h.state.save()
  const restored = new TelegramIntegrationState(h.root)
  try {
    await restored.load()
    const ctx = new TelegramSessionContext(
      h.ctx.client,
      restored,
      h.port,
      h.ctx.signal,
      () => false
    )
    expect(await ctx.operation(123)).toBe(operationId)
    expect(ctx.requested.has('session-1')).toBe(true)
    expect(restored.data.offset).toBe(124)
    expect(restored.data.actions[key]?.used).toBe(true)
  } finally {
    await restored.writer.waitForPendingWrite()
    restored.writer.close()
  }
})
