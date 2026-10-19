import type { TelegramSessionContext } from './telegram-session-context'
import type { TelegramMessage } from './telegram-bot-schema'
import type { TelegramSession } from './telegram-session-port'
import { hashTelegramPairingNonce } from './telegram-integration-state'
import { answerTelegramQuestionText } from './telegram-prompt-delivery'
import { confirmTelegramDraft, telegramMessageBody } from './telegram-message-input'
import { sendTelegramPreparedMessage } from './telegram-input-delivery'

export async function sendTelegramSessionMessage(
  ctx: TelegramSessionContext,
  session: TelegramSession,
  message: TelegramMessage,
  updateId: number
): Promise<void> {
  const threadId = message.message_thread_id
  if (!threadId) {
    throw new Error('Тема сессии недоступна.')
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
  if (!input || input.action.kind !== 'draft' || input.action.sessionId !== session.id) {
    throw new Error('Не удалось сохранить сообщение.')
  }
  const { confirmation } = input.action
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
  await sendTelegramPreparedMessage(
    ctx,
    session,
    inputKey,
    input.action.operationId ?? (await ctx.operation(updateId)),
    threadId
  )
}
