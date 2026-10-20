import { TelegramApiError } from './telegram-bot-client'
import type { TelegramSessionContext } from './telegram-session-context'

export const TELEGRAM_TOPIC_LIMIT = 10

export function telegramTopicOpenedAt(ctx: TelegramSessionContext): number {
  let openedAt = Date.now()
  for (const session of ctx.sessions.values()) {
    openedAt = Math.max(openedAt, session.updatedAt + 1)
  }
  for (const topic of Object.values(ctx.state.data.topics)) {
    openedAt = Math.max(openedAt, topic.lastUpdated + 1, (topic.lastOpenedAt ?? 0) + 1)
  }
  return openedAt
}

export function retainedTelegramSessionIds(ctx: TelegramSessionContext, preferredId?: string) {
  const activity = (id: string, updatedAt: number) =>
    Math.max(updatedAt, ctx.state.data.topics[id]?.lastOpenedAt ?? 0)
  const candidates = new Map(
    [...ctx.sessions.values()]
      .filter((session) => session.visible)
      .map((session) => [session.id, { id: session.id, updatedAt: session.updatedAt }])
  )
  for (const [id, topic] of Object.entries(ctx.state.data.topics)) {
    if (!ctx.sessions.has(id) && !topic.closed) {
      candidates.set(id, { id, updatedAt: topic.lastUpdated })
    }
  }
  const sessions = [...candidates.values()].sort((left, right) => {
    return (
      activity(right.id, right.updatedAt) - activity(left.id, left.updatedAt) ||
      left.id.localeCompare(right.id)
    )
  })
  return new Set(
    [
      ...new Set([
        ...ctx.requested,
        ...(preferredId ? [preferredId] : []),
        ...sessions.map((session) => session.id)
      ])
    ].slice(0, TELEGRAM_TOPIC_LIMIT)
  )
}

export async function removeExcessTelegramTopic(
  ctx: TelegramSessionContext,
  sessionId: string,
  retained = retainedTelegramSessionIds(ctx)
): Promise<void> {
  const topic = ctx.state.data.topics[sessionId]
  const owner = ctx.state.data.ownerId
  if (
    !topic ||
    !owner ||
    (!topic.deleting && (retained.has(sessionId) || ctx.requested.has(sessionId)))
  ) {
    return
  }
  // Persist intent so a crash after Telegram's deletion cannot resurrect the retired thread.
  topic.deleting = true
  await ctx.state.save()
  try {
    await ctx.client.deleteTopic(owner, topic.threadId, ctx.signal)
  } catch (error) {
    if (!(error instanceof TelegramApiError) || !error.topicMissing) {
      throw error
    }
  }
  ctx.state.data.retiredThreads[String(topic.threadId)] = {
    sessionId,
    name: topic.name,
    expiresAt: Date.now() + 49 * 60 * 60 * 1000
  }
  for (const [id, retired] of Object.entries(ctx.state.data.retiredThreads)) {
    if (retired.expiresAt < Date.now()) {
      delete ctx.state.data.retiredThreads[id]
    }
  }
  delete ctx.state.data.topics[sessionId]
  for (const stored of Object.values(ctx.state.data.actions)) {
    if (stored.threadId === topic.threadId) {
      if (stored.action.kind === 'route-draft' && !stored.used) {
        stored.threadId = undefined
      } else {
        stored.used = true
      }
    }
  }
  await ctx.state.save()
}

export async function reserveTelegramTopic(ctx: TelegramSessionContext, sessionId: string) {
  const retained = retainedTelegramSessionIds(ctx, sessionId)
  if (!retained.has(sessionId)) {
    throw new Error('Все десять тем ждут ответа на твои задачи. Дождись завершения одной из них.')
  }
  for (const id of Object.keys(ctx.state.data.topics)) {
    await removeExcessTelegramTopic(ctx, id, retained)
  }
  if (
    !ctx.state.data.topics[sessionId] &&
    Object.keys(ctx.state.data.topics).length >= TELEGRAM_TOPIC_LIMIT
  ) {
    throw new Error('Не удалось освободить тему Telegram. Повтори выбор сессии позже.')
  }
}
