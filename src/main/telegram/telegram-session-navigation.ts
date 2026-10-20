import type { TelegramSessionContext } from './telegram-session-context'
import type { TelegramAction } from './telegram-integration-state'
import { cancelTelegramTextPrompt } from './telegram-navigation-input'
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
    await showTelegramSessions(ctx, threadId, { ...action, query: undefined, messageId })
    return true
  }
  if (action.kind === 'session-search') {
    cancelTelegramTextPrompt(ctx, threadId)
    await showTelegramSessions(ctx, threadId, { page: 0, draftKey: action.draftKey, messageId })
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
