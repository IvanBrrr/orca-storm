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
import { TelegramApiError } from './telegram-bot-client'
import { answerTelegramWorktreeName } from './telegram-worktree-creation'
import { sendTelegramSessionMessage } from './telegram-session-input'
import { cancelTelegramTextPrompt } from './telegram-navigation-input'
import { showTelegramSessions } from './telegram-session-catalog'
import { saveTelegramNavigationDraft } from './telegram-navigation-draft'

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
  stored.used = ![
    'status',
    'stop',
    'workspaces',
    'sessions',
    'session-search',
    'session-select'
  ].includes(stored.action.kind)
  await ctx.state.save()
}

async function routeOwnerMessage(
  ctx: TelegramSessionContext,
  message: TelegramMessage,
  updateId: number
): Promise<void> {
  const threadId = message.message_thread_id
  const command = message.text?.split(/\s/)[0]?.split('@')[0]
  if (command === '/new' || command === '/cancel') {
    cancelTelegramTextPrompt(ctx, threadId)
    await ctx.state.save()
    if (command === '/cancel') {
      await showTelegramSessions(ctx, threadId)
      return
    }
    await showTelegramWorkspaces(ctx, threadId)
    return
  }
  if (await answerTelegramWorktreeName(ctx, message, updateId)) {
    return
  }
  if (command === '/start' || command === '/sessions' || command === '/help') {
    cancelTelegramTextPrompt(ctx, threadId)
    await showTelegramSessions(ctx, threadId)
    return
  }
  await ctx.refresh()
  const session = ctx.sessionForThread(threadId)
  if (!session || !threadId) {
    const binding = Object.entries(ctx.state.data.topics).find(
      ([, topic]) => topic.threadId === threadId
    )
    const draftKey = command?.startsWith('/')
      ? undefined
      : await saveTelegramNavigationDraft(ctx, message, updateId, binding?.[0])
    if (binding) {
      await ctx.menu(
        threadId,
        undefined,
        `Эта тема связана с сессией «${binding[1].name}». Сейчас Storca не может подтвердить её доступность.${draftKey ? '\n\nСообщение сохранено для этой сессии. Проверь связь с её хостом или открой сессию в Storca, затем нажми кнопку.' : ''}`,
        {
          inline_keyboard: [
            [
              ctx.button(
                draftKey ? 'Повторить в этой сессии' : 'Проверить сессию',
                { kind: 'session-open', sessionId: binding[0], draftKey },
                threadId
              )
            ]
          ]
        }
      )
      return
    }
    await showTelegramSessions(ctx, threadId, { draftKey })
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
  await sendTelegramSessionMessage(ctx, session, message, updateId)
}
