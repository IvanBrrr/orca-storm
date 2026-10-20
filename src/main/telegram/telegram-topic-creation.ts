import type { TelegramSessionContext } from './telegram-session-context'
import { telegramTopicName } from './telegram-session-context'
import type { TelegramSession } from './telegram-session-port'
import type { TelegramTopic } from './telegram-integration-state'
import { telegramTopicOpenedAt } from './telegram-topic-retention'

export async function createTelegramSessionTopic(
  ctx: TelegramSessionContext,
  session: TelegramSession,
  automatic: boolean
): Promise<TelegramTopic> {
  const owner = ctx.state.data.ownerId
  if (!owner) {
    throw new Error('Telegram ещё не привязан к владельцу.')
  }
  const name = telegramTopicName(session)
  const history = session.agent === 'codex' ? await ctx.port.history(session.id) : []
  const result = await ctx.client.topic(owner, name, ctx.signal)
  const topic: TelegramTopic = {
    threadId: result.message_thread_id,
    name,
    closed: !session.visible,
    seen: history
      .filter(
        (item) =>
          item.body.kind === 'message' &&
          item.body.role === 'assistant' &&
          item.body.state !== 'running'
      )
      .map((item) => `message:${item.itemId}`),
    lastUpdated: session.updatedAt,
    ...(automatic ? {} : { lastOpenedAt: telegramTopicOpenedAt(ctx) })
  }
  if (session.status?.turnOutcome) {
    ctx.remember(
      topic,
      `outcome:${session.status.statusStartedAt ?? session.status.updatedAt}:${session.status.turnOutcome}`
    )
  }
  ctx.state.data.topics[session.id] = topic
  await ctx.state.save()
  const keyboard = {
    inline_keyboard: [
      [
        ctx.button('Статус', { kind: 'status', sessionId: session.id }, topic.threadId),
        ctx.button('Остановить', { kind: 'stop', sessionId: session.id }, topic.threadId)
      ],
      [
        ctx.button('Все сессии', { kind: 'sessions', page: 0 }, topic.threadId),
        ctx.button('Новая сессия', { kind: 'workspaces', page: 0 }, topic.threadId)
      ]
    ]
  }
  await ctx.state.save()
  await ctx.text(
    topic.threadId,
    `Сессия Storca: ${name}\nАгент: ${session.agent}\n${session.agent === 'codex' ? 'Пиши сюда, чтобы продолжить разговор.' : 'Переписка через Telegram пока поддерживается для Codex.'}${session.source === 'terminal' ? '\nЗапросы разрешений в терминальных сессиях пока нужно подтверждать в Storca.' : ''} /new создаёт новую сессию.`,
    keyboard,
    { silent: true }
  )
  return topic
}
