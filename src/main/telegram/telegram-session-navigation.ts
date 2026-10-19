import type { TelegramSessionContext } from './telegram-session-context'
import type { TelegramAction } from './telegram-integration-state'
import type { TelegramMessage } from './telegram-bot-schema'
import { cancelTelegramTextPrompt, telegramTextPromptKey } from './telegram-navigation-input'
import { showTelegramSessions, showTelegramSessionCard } from './telegram-session-catalog'
import { deliverTelegramNavigationDraft } from './telegram-navigation-draft'
import { syncTelegramSessionProgress } from './telegram-session-progress'

export async function routeTelegramSessionNavigation(
  ctx: TelegramSessionContext,
  action: TelegramAction,
  threadId?: number,
  messageId?: number
): Promise<boolean> {
  if (action.kind === 'sessions') {
    cancelTelegramTextPrompt(ctx, threadId)
    await showTelegramSessions(ctx, threadId, { ...action, messageId })
    return true
  }
  if (action.kind === 'session-search') {
    cancelTelegramTextPrompt(ctx, threadId)
    const key = ctx.state.action({ kind: 'session-query', draftKey: action.draftKey }, threadId)
    await ctx.state.save()
    const id = await ctx.text(
      threadId,
      'Напиши название ворктрии или часть названия сессии следующим сообщением. /cancel — отмена поиска.',
      { force_reply: true, input_field_placeholder: 'Найти сессию' },
      { silent: true }
    )
    ctx.state.data.replies[String(id)] = key
    await ctx.state.save()
    return true
  }
  if (action.kind === 'session-select') {
    cancelTelegramTextPrompt(ctx, threadId)
    await showTelegramSessionCard(ctx, action.sessionId, threadId, { ...action, messageId })
    return true
  }
  if (action.kind !== 'session-open') {
    return false
  }
  await ctx.refresh()
  const session = ctx.sessions.get(action.sessionId)
  if (!session?.visible) {
    throw new Error('Сессия больше недоступна. Обнови список через /sessions.')
  }
  const topic = await ctx.topic(session)
  if (action.draftKey) {
    await deliverTelegramNavigationDraft(ctx, action.draftKey, session)
  } else {
    await ctx.text(topic.threadId, 'Сессия выбрана. Продолжай разговор здесь.', undefined, {
      silent: true
    })
    if (session.agent === 'codex') {
      await syncTelegramSessionProgress(ctx, session, topic, true, { snapshot: true })
    }
  }
  if (threadId !== topic.threadId) {
    await ctx.menu(
      threadId,
      messageId,
      `Продолжение в теме «${topic.name}». Открой её в списке тем.`,
      {
        inline_keyboard: [
          [ctx.button('Выбрать другую сессию', { kind: 'sessions', page: 0 }, threadId)]
        ]
      }
    )
  }
  return true
}

export async function answerTelegramSessionSearch(
  ctx: TelegramSessionContext,
  message: TelegramMessage,
  updateId?: number
): Promise<boolean> {
  const key = telegramTextPromptKey(ctx, message, 'session-query', updateId)
  const stored = key ? ctx.state.data.actions[key] : undefined
  if (!stored || stored.action.kind !== 'session-query') {
    return false
  }
  if (stored.used && stored.action.answerUpdateId === updateId && updateId !== undefined) {
    return true
  }
  if (
    stored.used ||
    stored.expiresAt <= Date.now() ||
    stored.threadId !== message.message_thread_id
  ) {
    await ctx.text(message.message_thread_id, 'Поиск устарел. Открой список через /sessions.')
    return true
  }
  const query = message.text?.trim()
  if (!query || query.length > 120) {
    await ctx.text(
      message.message_thread_id,
      'Для поиска нужен текст до 120 символов. Напиши запрос ещё раз или используй /cancel.'
    )
    return true
  }
  stored.action.answerUpdateId = updateId
  await ctx.state.save()
  await showTelegramSessions(ctx, message.message_thread_id, {
    query,
    draftKey: stored.action.draftKey,
    messageId: message.reply_to_message?.message_id
  })
  stored.used = true
  await ctx.state.save()
  return true
}
