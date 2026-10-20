import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import { isRootAgentJournalItem } from '../../shared/agent-session-journal-producer'
import { isKnownHarnessInjectedUserTurnText } from '../../shared/harness-injected-user-turns'
import type { TelegramSessionContext } from './telegram-session-context'
import type { TelegramSession } from './telegram-session-port'
import type { TelegramTopic } from './telegram-integration-state'

export function telegramHistoryText(item: AgentJournalRenderItem): string {
  if (
    !isRootAgentJournalItem(item) ||
    item.body.kind !== 'message' ||
    (item.body.role !== 'user' && item.body.role !== 'assistant') ||
    item.body.state === 'running'
  ) {
    return ''
  }
  const text = item.body.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
  return item.body.role === 'user' && isKnownHarnessInjectedUserTurnText(text) ? '' : text
}

export async function deliverTelegramSessionHistory(
  ctx: TelegramSessionContext,
  session: TelegramSession,
  topic: TelegramTopic
): Promise<void> {
  if (topic.historyDelivered) {
    return
  }
  const items = ctx.port.recentHistory
    ? await ctx.port.recentHistory(session.id, ctx.signal)
    : await ctx.port.history(session.id)
  if (!items) {
    return
  }
  const current = await ctx.port.history(session.id)
  const pendingReply =
    ctx.requested.has(session.id) &&
    topic.notifyReply &&
    !topic.progress?.pendingStart &&
    session.status?.status === 'idle'
      ? current.findLast(
          (item) =>
            item.body.kind === 'message' &&
            item.body.role === 'assistant' &&
            telegramHistoryText(item) &&
            !topic.seen.includes(`message:${item.itemId}`)
        )
      : undefined
  const pendingText = pendingReply ? telegramHistoryText(pendingReply) : ''
  const messages = items
    .filter((item) => telegramHistoryText(item) && telegramHistoryText(item) !== pendingText)
    .slice(-10)
  for (const item of messages) {
    const key = `history:${item.itemId}`
    if (topic.seen.includes(key)) {
      continue
    }
    const text = telegramHistoryText(item)
    const points = Array.from(text)
    const preview = points.slice(0, 2000).join('')
    const role = item.body.kind === 'message' && item.body.role === 'user' ? 'Ты' : 'Агент'
    await ctx.text(
      topic.threadId,
      `Из истории · ${role}\n\n${preview}${points.length > 2000 ? '\n\n… Полный текст доступен в Storca.' : ''}`,
      undefined,
      { silent: true }
    )
    ctx.remember(topic, key)
    ctx.remember(topic, `message:${item.itemId}`)
    await ctx.state.save()
  }
  const deliveredTexts = new Set(messages.map(telegramHistoryText))
  for (const item of current) {
    if (deliveredTexts.has(telegramHistoryText(item))) {
      ctx.remember(topic, `message:${item.itemId}`)
    }
  }
  topic.historyDelivered = true
  await ctx.state.save()
}
