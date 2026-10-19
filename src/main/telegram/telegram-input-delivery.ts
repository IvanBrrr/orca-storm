import type { TelegramSessionContext } from './telegram-session-context'
import type { TelegramSession } from './telegram-session-port'
import { telegramSendReceiptText } from './telegram-message-input'
import { TelegramInputNotDeliveredError } from './telegram-input-refusal'
import { syncTelegramSessionProgress } from './telegram-session-progress'

export async function sendTelegramPreparedMessage(
  ctx: TelegramSessionContext,
  session: TelegramSession,
  key: string,
  operationId: string,
  threadId: number
): Promise<void> {
  const input = ctx.state.data.actions[key]
  if (!input || input.action.kind !== 'draft' || input.action.sessionId !== session.id) {
    throw new Error('Черновик недоступен.')
  }
  if (input.used) {
    return
  }
  input.action.operationId = operationId
  ctx.request(session.id)
  await ctx.state.save()
  let queued: boolean
  try {
    queued = await ctx.port.send(session.id, operationId, input.action.body)
  } catch (error) {
    ctx.signal.throwIfAborted()
    const noDelivery =
      error instanceof TelegramInputNotDeliveredError ||
      (error instanceof Error &&
        /^terminal_guard_(permission|no_agent|not_writable)$/.test(error.message))
    const retry = ctx.state.action(
      {
        kind: 'draft',
        sessionId: session.id,
        body: input.action.body,
        ...(noDelivery ? {} : { operationId })
      },
      threadId
    )
    input.used = true
    const reason =
      error instanceof Error && error.message === 'terminal_guard_permission'
        ? 'Codex ждёт разрешения. Подтверди запрос в Storca.'
        : error instanceof Error && error.message === 'terminal_guard_no_agent'
          ? 'В этом терминале сейчас нет запущенного агента.'
          : error instanceof Error && error.message === 'terminal_guard_not_writable'
            ? 'Терминал сейчас недоступен для ввода.'
            : error instanceof Error
              ? error.message
              : 'Не удалось отправить сообщение.'
    const keyboard = {
      inline_keyboard: [
        [{ text: noDelivery ? 'Повторить отправку' : 'Проверить доставку', callback_data: retry }],
        [
          ctx.button(
            'Состояние и вывод',
            { kind: 'session-open', sessionId: session.id },
            threadId
          ),
          ctx.button('Отменить повтор', { kind: 'discard', target: retry }, threadId)
        ]
      ]
    }
    await ctx.state.save()
    await ctx.text(
      threadId,
      `${reason}\n\nЗадача сохранена. ${noDelivery ? 'Она не передана агенту.' : 'Результат отправки пока не подтверждён. Кнопка проверит ту же операцию без повторного выполнения.'}`,
      keyboard
    )
    return
  }
  input.used = true
  await ctx.state.save()
  await ctx.text(threadId, telegramSendReceiptText(session, queued), undefined, { silent: true })
  try {
    await ctx.refresh()
    const current = ctx.sessions.get(session.id) ?? session
    await syncTelegramSessionProgress(ctx, current, await ctx.topic(current), true, {
      snapshot: true,
      pendingStart: queued && current.turnStartedAt === session.turnStartedAt,
      prompt: input.action.body.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
    })
  } catch {
    ctx.signal.throwIfAborted()
  }
}
