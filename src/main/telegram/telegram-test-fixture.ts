import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, vi } from 'vitest'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import {
  getSecretStore,
  hasSecretStore,
  setSecretStore,
  _resetSecretStoreForTests,
  type SecretStore
} from '../../shared/secret-store'
import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import type { TelegramSession, TelegramSessionPort } from './telegram-session-port'
import type { TelegramMessage, TelegramUpdate } from './telegram-bot-schema'
import { TelegramIntegrationState } from './telegram-integration-state'
import { TelegramBotClient } from './telegram-bot-client'
import { TelegramSessionContext } from './telegram-session-context'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
})

export async function telegramTestFixture() {
  const previousSecrets = hasSecretStore() ? getSecretStore() : null
  const key = randomBytes(32)
  const secrets: SecretStore = {
    isEncryptionAvailable: () => true,
    describeProtectionGap: () => null,
    encryptString: (plaintext) => {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
    },
    decryptString: (bytes) => {
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    }
  }
  setSecretStore(secrets)
  const root = await mkdtemp(join(tmpdir(), 'orca-telegram-'))
  const state = new TelegramIntegrationState(root)
  state.data.ownerId = 42
  state.data.bot = { id: 12345, username: 'orca_test_bot', topicsEnabled: true }
  const sessions: TelegramSession[] = [
    {
      id: 'session-1',
      workspaceId: 'workspace-1',
      name: 'Work',
      agent: 'codex',
      visible: true,
      updatedAt: 1,
      status: null
    }
  ]
  let items: AgentJournalRenderItem[] = []
  const sent: { method: string; params: Record<string, unknown> }[] = []
  let sequence = 100
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const method = String(input).split('/').at(-1) ?? ''
    const params: Record<string, unknown> =
      typeof init?.body === 'string' ? JSON.parse(init.body) : {}
    sent.push({ method, params })
    const result =
      method === 'createForumTopic'
        ? { message_thread_id: ++sequence }
        : method === 'sendMessage'
          ? { message_id: ++sequence }
          : method === 'getMe'
            ? { id: 12345, username: 'orca_test_bot', is_bot: true, has_topics_enabled: true }
            : method === 'getWebhookInfo'
              ? { url: '' }
              : true
    return Response.json({ ok: true, result })
  })
  const send = vi.fn<TelegramSessionPort['send']>(async () => false)
  const stop = vi.fn<TelegramSessionPort['stop']>(async () => {})
  const respond = vi.fn<TelegramSessionPort['respond']>(async () => {})
  const create = vi.fn<TelegramSessionPort['create']>(async () => {
    const next: TelegramSession = { ...sessions[0]!, id: 'session-2', name: 'New session' }
    sessions.push(next)
    return next.id
  })
  const port: TelegramSessionPort = {
    list: async () => sessions,
    workspaces: async () => [{ id: 'workspace-1', name: 'Project' }],
    create,
    send,
    stop,
    respond,
    history: async () => items,
    hasPendingMessages: async () => false,
    pendingPrompts: async () =>
      items.filter(
        (item) =>
          (item.body.kind === 'approval' || item.body.kind === 'question') &&
          item.body.resolution.state === 'pending'
      ),
    prompt: async (_sessionId, itemId) => items.find((item) => item.itemId === itemId),
    upload: async (_sessionId, name) => join(root, name),
    outputFiles: async () => [],
    transcribe: async () => 'Voice task'
  }
  const abort = new AbortController()
  let away = false
  const client = new TelegramBotClient('12345:abcdefghijklmnopqrstuvwxyz', fetcher, 0)
  const ctx = new TelegramSessionContext(client, state, port, abort.signal, () => away)
  await ctx.refresh()
  cleanups.push(async () => {
    abort.abort()
    await state.writer.waitForPendingWrite()
    state.writer.close()
    await rm(root, { recursive: true, force: true })
    if (previousSecrets) {
      setSecretStore(previousSecrets)
    } else {
      _resetSecretStoreForTests()
    }
  })
  return {
    ctx,
    state,
    port,
    sessions,
    sent,
    send,
    stop,
    respond,
    create,
    root,
    secrets,
    fetcher,
    setItems: (next: AgentJournalRenderItem[]) => {
      items = next
    },
    setAway: (next: boolean) => {
      away = next
    }
  }
}

export function telegramTestMessage(overrides: Partial<TelegramMessage> = {}): TelegramMessage {
  return {
    message_id: 10,
    date: Math.ceil(Date.now() / 1000),
    chat: { id: 42, type: 'private' },
    from: { id: 42, is_bot: false },
    message_thread_id: 101,
    text: 'Task',
    ...overrides
  }
}

export function telegramTestCallback(key: string, threadId?: number): TelegramUpdate {
  return {
    update_id: 20,
    callback_query: {
      id: 'callback',
      from: { id: 42, is_bot: false },
      data: key,
      message: telegramTestMessage({ message_thread_id: threadId })
    }
  }
}

export function telegramTestItem(
  body: AgentJournalRenderItem['body'],
  itemId = 'item-1',
  revision = 1
): AgentJournalRenderItem {
  return { itemId, revision, body, sequence: 1, observedAt: Date.now() }
}

export const pendingTelegramResolution = {
  state: 'pending',
  selectedOptionId: null,
  resolvedBy: null,
  resolvedAt: null
} as const
