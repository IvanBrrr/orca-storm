import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getSecretStore } from '../../shared/secret-store'
import { SendBodyStructure } from '../../shared/rpc-contract/structured-agent-session-message-params'
import { AtomicSnapshotWriter } from '../persistence/atomic-snapshot-writer'
import { createStructuredAgentSessionOperationId } from '../../shared/structured-agent-session-mutation'
import { TelegramMessage } from './telegram-bot-schema'

const PromptAnswer = z.object({
  questionId: z.string(),
  optionIds: z.array(z.string()),
  other: z.string().optional()
})
export const TelegramAction = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('sessions'),
    page: z.number().int().nonnegative(),
    query: z.string().optional(),
    draftKey: z.string().optional()
  }),
  z.object({ kind: z.literal('session-search'), draftKey: z.string().optional() }),
  z.object({
    kind: z.literal('session-query'),
    draftKey: z.string().optional(),
    answerUpdateId: z.number().int().optional()
  }),
  z.object({
    kind: z.literal('session-select'),
    sessionId: z.string(),
    page: z.number().int().nonnegative(),
    query: z.string().optional(),
    draftKey: z.string().optional()
  }),
  z.object({
    kind: z.literal('session-open'),
    sessionId: z.string(),
    draftKey: z.string().optional()
  }),
  z.object({
    kind: z.literal('route-draft'),
    message: TelegramMessage,
    updateId: z.number().int(),
    targetSessionId: z.string().optional()
  }),
  z.object({
    kind: z.literal('new-worktree'),
    page: z.number().int().nonnegative().default(0),
    draftKey: z.string().optional()
  }),
  z.object({
    kind: z.literal('worktree-repo'),
    repoId: z.string(),
    draftKey: z.string().optional()
  }),
  z.object({
    kind: z.literal('worktree-name'),
    repoId: z.string(),
    name: z.string().optional(),
    answerUpdateId: z.number().int().optional(),
    draftKey: z.string().optional()
  }),
  z.object({
    kind: z.literal('workspaces'),
    page: z.number().int().nonnegative(),
    draftKey: z.string().optional()
  }),
  z.object({ kind: z.literal('create'), workspace: z.string(), draftKey: z.string().optional() }),
  z.object({ kind: z.literal('stop'), sessionId: z.string(), turnId: z.string().optional() }),
  z.object({ kind: z.literal('status'), sessionId: z.string() }),
  z.object({
    kind: z.literal('draft'),
    sessionId: z.string(),
    body: SendBodyStructure,
    replyToQuestion: z.string().optional(),
    confirmation: z.enum(['none', 'voice', 'offline']).optional(),
    operationId: z.string().optional()
  }),
  z.object({ kind: z.literal('discard'), target: z.string().optional() }),
  z.object({
    kind: z.literal('prompt'),
    sessionId: z.string(),
    itemId: z.string(),
    revision: z.number(),
    promptKind: z.enum(['approval', 'question']),
    optionId: z.string().optional(),
    answers: z.array(PromptAnswer).optional()
  }),
  z.object({
    kind: z.literal('question'),
    sessionId: z.string(),
    itemId: z.string(),
    revision: z.number(),
    index: z.number().int().nonnegative(),
    answers: z.array(PromptAnswer),
    selected: z.array(z.string()),
    toggle: z.string().optional(),
    next: z.boolean().optional()
  })
])
export type TelegramAction = z.infer<typeof TelegramAction>
const Topic = z.object({
  threadId: z.number().int().positive(),
  name: z.string(),
  closed: z.boolean().default(false),
  seen: z.array(z.string()).default([]),
  historyDelivered: z.boolean().optional(),
  notifyReply: z.boolean().optional(),
  progress: z
    .object({
      key: z.string(),
      messageId: z.number().int().positive(),
      threadId: z.number().int().positive(),
      head: z.string(),
      text: z.string(),
      updatedAt: z.number(),
      settled: z.boolean().optional(),
      pendingStart: z.boolean().optional()
    })
    .optional(),
  lastUpdated: z.number().default(0)
})
const State = z.object({
  version: z.literal(1),
  encryptedToken: z.string().default(''),
  bot: z
    .object({ id: z.number(), username: z.string(), topicsEnabled: z.boolean() })
    .nullable()
    .default(null),
  ownerId: z.number().int().positive().nullable().default(null),
  offset: z.number().int().nonnegative().default(0),
  notificationsEnabled: z.boolean().default(true),
  pairing: z.object({ hash: z.string(), expiresAt: z.number() }).nullable().default(null),
  topics: z.record(z.string(), Topic).default({}),
  replySessions: z.array(z.string()).default([]),
  operations: z.record(z.string(), z.object({ id: z.string(), expiresAt: z.number() })).default({}),
  actions: z
    .record(
      z.string(),
      z.object({
        action: TelegramAction,
        expiresAt: z.number(),
        used: z.boolean().default(false),
        threadId: z.number().optional()
      })
    )
    .default({}),
  replies: z.record(z.string(), z.string()).default({})
})
export type TelegramState = z.infer<typeof State>
export type TelegramTopic = z.infer<typeof Topic>

export class TelegramIntegrationState {
  readonly writer: AtomicSnapshotWriter
  data: TelegramState = State.parse({ version: 1 })
  private readonly path: string

  constructor(readonly directory: string) {
    this.path = join(directory, 'telegram-integration.json')
    this.writer = new AtomicSnapshotWriter(() => this.path, {
      fileMode: 0o600,
      directoryMode: 0o700,
      skipUnchanged: true
    })
  }
  async load(): Promise<void> {
    let bytes: Buffer
    try {
      bytes = await readFile(this.path)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return
      }
      throw new Error('Не удалось прочитать настройки Telegram.')
    }
    if (bytes.byteLength > 16 * 1024 * 1024) {
      throw new Error('Файл настроек Telegram слишком велик.')
    }
    this.data = State.parse(JSON.parse(bytes.toString('utf8')))
  }
  save(): Promise<void> {
    return this.writer.write(() => JSON.stringify(this.data))
  }
  async operation(identity: string): Promise<string> {
    const key = hashTelegramPairingNonce(identity)
    let operation = this.data.operations[key]
    if (!operation) {
      operation = {
        id: createStructuredAgentSessionOperationId(randomUUID),
        expiresAt: Date.now() + 49 * 60 * 60 * 1000
      }
      this.data.operations[key] = operation
    }
    await this.save()
    return operation.id
  }
  token(): string {
    if (!this.data.encryptedToken) {
      return ''
    }
    return getSecretStore().decryptString(Buffer.from(this.data.encryptedToken, 'base64'))
  }
  setToken(token: string): void {
    const secrets = getSecretStore()
    if (!secrets.isEncryptionAvailable()) {
      throw new Error('Хранилище секретов недоступно. Токен не сохранён.')
    }
    this.data.encryptedToken = secrets.encryptString(token).toString('base64')
  }
  action(action: TelegramAction, threadId?: number, identity?: string): string {
    this.pruneActions()
    const key = identity
      ? hashTelegramPairingNonce(identity).slice(0, 24)
      : randomBytes(12).toString('base64url')
    if (this.data.actions[key]) {
      return key
    }
    if (Object.keys(this.data.actions).length >= 4000) {
      throw new Error('Слишком много ожидающих действий Telegram.')
    }
    this.data.actions[key] = {
      action,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      used: false,
      ...(threadId ? { threadId } : {})
    }
    return key
  }
  private pruneActions(): void {
    for (const [key, value] of Object.entries(this.data.operations)) {
      if (value.expiresAt < Date.now()) {
        delete this.data.operations[key]
      }
    }
    for (const [key, value] of Object.entries(this.data.actions)) {
      if (value.expiresAt < Date.now()) {
        delete this.data.actions[key]
      }
    }
    for (const [key, actionId] of Object.entries(this.data.replies)) {
      if (!this.data.actions[actionId]) {
        delete this.data.replies[key]
      }
    }
  }
  beginPairing(): string {
    const nonce = randomBytes(24).toString('base64url')
    this.data.pairing = {
      hash: hashTelegramPairingNonce(nonce),
      expiresAt: Date.now() + 10 * 60 * 1000
    }
    return nonce
  }
  reset(): void {
    this.data = State.parse({ version: 1 })
  }
}

export function hashTelegramPairingNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}
