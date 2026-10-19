import {
  routeOwnerAction,
  requireActiveSession,
  showTelegramStatus,
  showTelegramWorkspaces
} from './telegram-owner-actions'
import { timingSafeEqual } from 'node:crypto'
import type { TelegramMessage, TelegramUpdate } from './telegram-bot-schema'
import type { TelegramSessionContext } from './telegram-session-context'
import { hashTelegramPairingNonce } from './telegram-integration-state'
import { answerTelegramQuestionText } from './telegram-prompt-delivery'
import {
  confirmTelegramDraft,
  telegramMessageBody,
  telegramSendReceiptText
} from './telegram-message-input'
import { TelegramApiError } from './telegram-bot-client'
import { answerTelegramWorktreeName } from './telegram-worktree-creation'

export async function routeTelegramUpdate(
  ctx: TelegramSessionContext,
  update: TelegramUpdate
): Promise<void> {
  return ctx.exclusive(() => routeTelegramUpdateExclusive(ctx, update))
}

async function routeTelegramUpdateExclusive(
  ctx: TelegramSessionContext,
  update: TelegramUpdate
): Promise<void> {
  const message = update.message
  if (
    message?.chat.type === 'private' &&
    message.from &&
    !message.from.is_bot &&
    message.from.id === message.chat.id
  ) {
    const nonce = message.text?.match(/^\/start\s+([A-Za-z0-9_-]{32})$/)?.[1]
    const pairing = ctx.state.data.pairing
    if (
      nonce &&
      pairing &&
      pairing.expiresAt > Date.now() &&
      timingSafeEqual(Buffer.from(pairing.hash), Buffer.from(hashTelegramPairingNonce(nonce)))
    ) {
      if (ctx.state.data.ownerId !== message.from.id) {
        ctx.state.data.topics = {}
        ctx.state.data.actions = {}
        ctx.state.data.replies = {}
        ctx.state.data.replySessions = []
        ctx.requested.clear()
      }
      ctx.state.data.ownerId = message.from.id
      ctx.state.data.pairing = null
      await ctx.state.save()
      await ctx.text(
        undefined,
        'Telegram подключён к Storca. Темы сессий появятся автоматически. /new создаёт новую сессию, /sessions обновляет список.'
      )
      return
    }
    if (message.from.id !== ctx.state.data.ownerId) {
      return
    }
    await routeOwnerMessage(ctx, message, update.update_id)
    return
  }
  const callback = update.callback_query
  if (
    !callback ||
    callback.from.is_bot ||
    callback.from.id !== ctx.state.data.ownerId ||
    callback.message?.chat.type !== 'private' ||
    callback.message.chat.id !== ctx.state.data.ownerId
  ) {
    return
  }
  try {
    await ctx.client.answerCallback(callback.id, ctx.signal)
  } catch (error) {
    if (!(error instanceof TelegramApiError) || error.code !== 400) {
      throw error
    }
  }
  const key = callback.data ?? ''
  const stored = ctx.state.data.actions[key]
  const threadId = callback.message.message_thread_id
  if (!stored || stored.expiresAt < Date.now() || stored.used || stored.threadId !== threadId) {
    await ctx.text(
      threadId,
      'Эта кнопка уже использована или устарела. /status показывает текущее состояние.'
    )
    return
  }
  await routeOwnerAction(
    ctx,
    stored.action,
    key,
    threadId,
    update.update_id,
    callback.message.message_id
  )
  stored.used =
    stored.action.kind !== 'status' &&
    stored.action.kind !== 'stop' &&
    stored.action.kind !== 'workspaces'
  await ctx.state.save()
}

async function routeOwnerMessage(
  ctx: TelegramSessionContext,
  message: TelegramMessage,
  updateId: number
): Promise<void> {
  const threadId = message.message_thread_id
  const command = message.text?.split(/\s/)[0]?.split('@')[0]
  if (await answerTelegramWorktreeName(ctx, message)) {
    return
  }
  if (command === '/new') {
    await showTelegramWorkspaces(ctx, threadId)
    return
  }
  if (command === '/start' || command === '/sessions' || command === '/help') {
    await ctx.refresh()
    const sessions = [...ctx.sessions.values()].filter((session) => session.visible)
    for (const session of sessions) {
      await ctx.topic(session)
    }
    await ctx.text(
      threadId,
      `Сессий Storca: ${sessions.length}. Каждая находится в своей теме.\n/new — новая сессия\n/status — состояние сессии\n/stop — остановить текущую работу`
    )
    return
  }
  await ctx.refresh()
  const session = ctx.sessionForThread(threadId)
  if (!session || !threadId) {
    await ctx.text(threadId, 'Выбери тему сессии или используй /new, чтобы создать новую.')
    return
  }
  if (command === '/status') {
    await showTelegramStatus(ctx, session.id, threadId)
    return
  }
  requireActiveSession(ctx, session.id)
  if (command === '/stop') {
    await ctx.port.stop(session.id, await ctx.operation(updateId))
    await ctx.text(threadId, 'Запрос остановки передан в Storca.')
    return
  }
  if (command?.startsWith('/')) {
    await ctx.text(threadId, 'Доступные команды: /new, /sessions, /status, /stop.')
    return
  }
  const replyKey =
    message.reply_to_message && ctx.state.data.replies[String(message.reply_to_message.message_id)]
  const reply = replyKey ? ctx.state.data.actions[replyKey] : undefined
  if (reply?.action.kind === 'question' && reply.threadId === threadId) {
    if (reply.used || reply.expiresAt < Date.now()) {
      throw new Error('Ответ на этот вопрос уже отправлен или устарел.')
    }
    if (message.text) {
      await answerTelegramQuestionText(ctx, reply.action, message.text)
      reply.used = true
      await ctx.state.save()
      return
    }
    if (!message.voice) {
      throw new Error('Ответь на вопрос текстом или голосовым сообщением.')
    }
  }
  const inputIdentity = ctx.identity(`input:${updateId}`)
  const inputKey = hashTelegramPairingNonce(inputIdentity).slice(0, 24)
  let input = ctx.state.data.actions[inputKey]
  if (!input) {
    const prepared = await telegramMessageBody(ctx, session.id, message)
    const confirmation = prepared.confirm
      ? 'voice'
      : message.date * 1000 < ctx.pollingStartedAt - 1000
        ? 'offline'
        : 'none'
    ctx.state.action(
      {
        kind: 'draft',
        sessionId: session.id,
        body: prepared.body,
        confirmation,
        ...(replyKey && reply?.action.kind === 'question' && reply.threadId === threadId
          ? { replyToQuestion: replyKey }
          : {})
      },
      threadId,
      inputIdentity
    )
    await ctx.state.save()
    input = ctx.state.data.actions[inputKey]
  }
  if (!input || input.action.kind !== 'draft') {
    throw new Error('Не удалось сохранить сообщение.')
  }
  const { body, confirmation } = input.action
  if (confirmation && confirmation !== 'none') {
    if (!input.used) {
      await confirmTelegramDraft(
        ctx,
        threadId,
        inputKey,
        confirmation === 'voice'
          ? 'Распознано из голосового:'
          : 'Сообщение получено, пока Storca была выключена. Передать агенту?'
      )
    }
    return
  }
  ctx.request(session.id)
  const queued = await ctx.port.send(session.id, await ctx.operation(updateId), body)
  input.used = true
  await ctx.state.save()
  await ctx.text(threadId, telegramSendReceiptText(session, queued))
}
