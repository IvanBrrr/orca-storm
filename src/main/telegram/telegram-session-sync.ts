import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import type { TelegramSessionContext } from './telegram-session-context'
import { deliverTelegramPrompt } from './telegram-prompt-delivery'
import type { TelegramTopic } from './telegram-integration-state'
import { deliverTelegramSessionHistory } from './telegram-session-history'
import { syncTelegramSessionProgress } from './telegram-session-progress'

function completedMessage(item: AgentJournalRenderItem): boolean {
  return (
    item.body.kind === 'message' && item.body.role === 'assistant' && item.body.state !== 'running'
  )
}

export async function syncTelegramSessions(ctx: TelegramSessionContext): Promise<void> {
  if (!ctx.state.data.ownerId) {
    return
  }
  await ctx.exclusive(() => ctx.refresh())
  const away = ctx.isAway() !== false
  const becameAway = away && !ctx.wasAway
  ctx.wasAway = away
  let firstError: unknown
  for (const sessionId of ctx.sessions.keys()) {
    try {
      await ctx.exclusive(async () => {
        const session = ctx.sessions.get(sessionId)
        if (!session || (!session.visible && !ctx.state.data.topics[sessionId])) {
          return
        }
        const topic = await ctx.topic(session)
        if (topic.closed !== !session.visible) {
          topic.closed = !session.visible
          await ctx.state.save()
          if (topic.closed) {
            ctx.finishRequest(sessionId)
            await ctx.state.save()
            await ctx.text(
              topic.threadId,
              'Сессия закрыта в Storca. История сохранена, уведомления прекращены.'
            )
          }
        }
        if (topic.closed) {
          return
        }
        if (session.agent !== 'codex') {
          return
        }
        try {
          await deliverTelegramSessionHistory(ctx, session, topic)
        } catch (error) {
          firstError ??= error
        }
        const deliver =
          ctx.requested.has(sessionId) || (away && ctx.state.data.notificationsEnabled)
        try {
          await syncTelegramSessionProgress(ctx, session, topic, deliver)
        } catch (error) {
          firstError ??= error
        }
        if (
          topic.lastUpdated === session.updatedAt &&
          !becameAway &&
          !ctx.requested.has(sessionId)
        ) {
          return
        }
        const items = await ctx.port.history(sessionId)
        const messages = items.filter(completedMessage)
        const prompts =
          session.status?.status === 'attention'
            ? await ctx.port.pendingPrompts(sessionId)
            : items.filter(
                (item) =>
                  (item.body.kind === 'approval' || item.body.kind === 'question') &&
                  item.body.resolution.state === 'pending'
              )
        let deliveredMessage = false
        // Wait for a settled turn so partial provider prose is never frozen into a Telegram message.
        if (session.status?.status !== 'working') {
          for (const item of messages) {
            const key = `message:${item.itemId}`
            if (topic.seen.includes(key)) {
              continue
            }
            if (deliver) {
              await sendTelegramAssistantMessage(ctx, sessionId, topic, item)
              deliveredMessage = true
            }
            ctx.remember(topic, key)
            await ctx.state.save()
          }
        }
        for (const item of prompts) {
          const key = `prompt:${item.itemId}:${item.revision}`
          if (!deliver || topic.seen.includes(key)) {
            continue
          }
          await deliverTelegramPrompt(ctx, sessionId, item)
          ctx.remember(topic, key)
          await ctx.state.save()
        }
        const outcome = session.status?.turnOutcome
        let settledOutcome = false
        if (session.status?.status === 'idle' && outcome) {
          const key = `outcome:${session.status.statusStartedAt ?? session.status.updatedAt}:${outcome}`
          if (!topic.seen.includes(key)) {
            if (deliver && (outcome !== 'success' || !deliveredMessage)) {
              const text =
                outcome === 'failure'
                  ? 'Агент сообщил об ошибке. Подробности доступны в сессии Storca.'
                  : outcome === 'cancellation'
                    ? 'Работа остановлена.'
                    : outcome === 'interruption'
                      ? 'Выполнение прервалось. Проверь сессию в Storca.'
                      : outcome === 'unconfirmed'
                        ? 'Результат хода не подтверждён. Проверь связь с хостом в Storca.'
                        : outcome === 'superseded'
                          ? 'Предыдущий ход заменён новой задачей.'
                          : 'Ход завершён.'
              await ctx.text(topic.threadId, text)
            }
            ctx.remember(topic, key)
            settledOutcome = true
          }
        }
        if (
          session.status?.status === 'idle' &&
          !topic.progress?.pendingStart &&
          (deliveredMessage || settledOutcome) &&
          !(await ctx.port.hasPendingMessages(sessionId))
        ) {
          ctx.finishRequest(sessionId)
        }
        topic.lastUpdated = session.updatedAt
        await ctx.state.save()
      })
    } catch (error) {
      if (ctx.signal.aborted) {
        throw error
      }
      firstError ??= error
    }
  }
  if (firstError) {
    throw firstError
  }
}

async function sendTelegramAssistantMessage(
  ctx: TelegramSessionContext,
  sessionId: string,
  topic: TelegramTopic,
  item: AgentJournalRenderItem
): Promise<void> {
  if (item.body.kind !== 'message') {
    return
  }
  const text = item.body.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
  const ownerId = ctx.state.data.ownerId
  if (!ownerId) {
    return
  }
  if (text.length > 10_000) {
    await ctx.text(
      topic.threadId,
      `${Array.from(text).slice(0, 1500).join('')}\n\nПолный ответ прикреплён файлом.`
    )
    await ctx.document(topic.threadId, Buffer.from(text), 'answer.md')
  } else if (text) {
    await ctx.text(topic.threadId, text)
  }
  for (const file of await ctx.port.outputFiles(sessionId, [item])) {
    await ctx.client.document(ownerId, topic.threadId, file.bytes, file.name, ctx.signal)
  }
}
