import type { TelegramSessionContext } from './telegram-session-context'
import type { TelegramSession } from './telegram-session-port'
import type { TelegramMessage } from './telegram-bot-schema'
import { hashTelegramPairingNonce } from './telegram-integration-state'
import { sendTelegramSessionMessage } from './telegram-session-input'

export function latestTelegramNavigationDraft(
  ctx: TelegramSessionContext,
  threadId?: number
): string | undefined {
  return Object.entries(ctx.state.data.actions).findLast(
    ([, stored]) =>
      stored.action.kind === 'route-draft' &&
      !stored.used &&
      stored.expiresAt > Date.now() &&
      stored.threadId === threadId
  )?.[0]
}

export async function saveTelegramNavigationDraft(
  ctx: TelegramSessionContext,
  message: TelegramMessage,
  updateId: number
): Promise<string> {
  const identity = ctx.identity(`route:${updateId}`)
  const key = hashTelegramPairingNonce(identity).slice(0, 24)
  if (!ctx.state.data.actions[key]) {
    ctx.state.action(
      { kind: 'route-draft', message, updateId },
      message.message_thread_id,
      identity
    )
  }
  await ctx.state.save()
  return key
}

export async function deliverTelegramNavigationDraft(
  ctx: TelegramSessionContext,
  key: string | undefined,
  session: TelegramSession
): Promise<void> {
  if (!key) {
    return
  }
  const stored = ctx.state.data.actions[key]
  if (!stored || stored.action.kind !== 'route-draft' || stored.expiresAt <= Date.now()) {
    throw new Error('Черновик устарел. Отправь задачу ещё раз.')
  }
  if (stored.used) {
    return
  }
  if (!session.visible || session.agent !== 'codex') {
    throw new Error('Выбери открытую сессию Codex для этой задачи.')
  }
  if (stored.action.targetSessionId && stored.action.targetSessionId !== session.id) {
    throw new Error(
      'Этот черновик уже подготовлен для другой сессии. Отправь новую задачу для смены получателя.'
    )
  }
  stored.action.targetSessionId = session.id
  await ctx.state.save()
  const topic = await ctx.topic(session)
  await sendTelegramSessionMessage(
    ctx,
    session,
    { ...stored.action.message, message_thread_id: topic.threadId, reply_to_message: undefined },
    stored.action.updateId
  )
  stored.used = true
  await ctx.state.save()
}
