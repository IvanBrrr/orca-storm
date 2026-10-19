import type { TelegramMessage } from './telegram-bot-schema'
import type { TelegramSessionContext } from './telegram-session-context'

export function cancelTelegramTextPrompt(ctx: TelegramSessionContext, threadId?: number): void {
  for (const stored of Object.values(ctx.state.data.actions)) {
    if (
      ['worktree-name', 'session-query'].includes(stored.action.kind) &&
      stored.threadId === threadId
    ) {
      stored.used = true
    }
  }
}

export function telegramTextPromptKey(
  ctx: TelegramSessionContext,
  message: TelegramMessage,
  kind: 'worktree-name' | 'session-query',
  updateId?: number
): string | undefined {
  if (message.text?.trimStart().startsWith('/')) {
    return undefined
  }
  const answered =
    updateId === undefined
      ? undefined
      : Object.entries(ctx.state.data.actions).findLast(
          ([, stored]) =>
            (stored.action.kind === 'session-query' || stored.action.kind === 'worktree-name') &&
            stored.action.kind === kind &&
            stored.action.answerUpdateId === updateId &&
            stored.threadId === message.message_thread_id
        )
  if (answered) {
    return answered[0]
  }
  if (message.reply_to_message) {
    return ctx.state.data.replies[String(message.reply_to_message.message_id)]
  }
  return Object.entries(ctx.state.data.actions).findLast(
    ([, action]) =>
      action.action.kind === kind &&
      !action.used &&
      action.expiresAt > Date.now() &&
      action.threadId === message.message_thread_id
  )?.[0]
}
