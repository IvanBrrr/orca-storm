import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import { isRootAgentJournalItem } from '../../shared/agent-session-journal-producer'
import { formatWorkerTranscriptMessage } from '../../shared/worker-transcript-text'
import { boundStructuredJournalTail } from '../runtime/orchestration/structured-worker-journal-archive'
import { TelegramApiError } from './telegram-bot-client'
import type { TelegramSessionContext } from './telegram-session-context'
import type { TelegramSession } from './telegram-session-port'
import type { TelegramTopic } from './telegram-integration-state'
import { telegramHistoryText } from './telegram-session-history'

export function projectTelegramSessionProgress(items: AgentJournalRenderItem[]) {
  const start = items.findLastIndex(
    (item) =>
      isRootAgentJournalItem(item) && item.body.kind === 'message' && item.body.role === 'user'
  )
  const turn = items.slice(Math.max(0, start)).filter(isRootAgentJournalItem)
  return {
    key: items[start]?.itemId ?? 'current',
    start: items[start] ? telegramHistoryText(items[start]) : '',
    lines: boundStructuredJournalTail(turn)
      .messages.filter((message) => message.role !== 'reasoning')
      .flatMap((message) => formatWorkerTranscriptMessage(message).split('\n'))
      .slice(-100)
  }
}

export async function syncTelegramSessionProgress(
  ctx: TelegramSessionContext,
  session: TelegramSession,
  topic: TelegramTopic,
  deliver: boolean,
  options: { snapshot?: boolean; pendingStart?: boolean; prompt?: string } = {}
): Promise<void> {
  const status = session.status?.status
  const active = status === 'working' || status === 'attention'
  if (!options.snapshot && (!deliver || !active) && (!topic.progress || topic.progress.settled)) {
    return
  }
  if (
    active &&
    !options.snapshot &&
    topic.progress &&
    !topic.progress.settled &&
    Date.now() - topic.progress.updatedAt < 8000
  ) {
    return
  }
  const snapshot =
    status || options.snapshot
      ? ctx.port.progress
        ? await ctx.port.progress(session.id)
        : projectTelegramSessionProgress(await ctx.port.history(session.id))
      : null
  const existing = topic.progress
  const newStart = existing?.pendingStart && snapshot && existing.key !== snapshot.key
  const pendingStart = options.pendingStart ?? (existing?.pendingStart === true && !newStart)
  const sameTurn =
    existing &&
    !(options.prompt && existing.settled) &&
    (existing.pendingStart || !active || !snapshot || existing.key === snapshot.key)
  if (active && !deliver && !sameTurn) {
    return
  }
  const head =
    sameTurn && !options.prompt
      ? existing.head
      : `${options.prompt ?? snapshot?.start ?? ''}\n${snapshot?.lines.slice(0, 5).join('\n') ?? ''}`.trim()
  const tail = snapshot?.lines.slice(-100).join('\n') ?? ''
  const label = pendingStart
    ? 'Начало нового хода пока не подтверждено'
    : status === 'working'
      ? 'Работает'
      : status === 'attention'
        ? 'Ждёт ответа'
        : status === 'idle'
          ? options.snapshot
            ? 'Ожидает задачу'
            : 'Ход завершён'
          : 'Состояние не подтверждено'
  const clippedHead = head.slice(0, 400).replace(/[\uD800-\uDBFF]$/, '')
  const clippedTail = tail.slice(-2700).replace(/^[\uDC00-\uDFFF]/, '')
  const text =
    !snapshot && existing
      ? existing.text.replace(/^Ход работы ·[^\n]*/, `Ход работы · ${label}`)
      : `Ход работы · ${label}\n\nНачало:\n${clippedHead || 'Начало хода недоступно.'}\n\nПоследние строки (до 100):\n${clippedTail || 'Новых строк пока нет.'}${tail.length > clippedTail.length ? '\n\nЧасть строк сокращена под лимит Telegram.' : ''}`
  if (sameTurn && existing.text === text && existing.threadId === topic.threadId) {
    return
  }
  let messageId = sameTurn && existing.threadId === topic.threadId ? existing.messageId : undefined
  if (messageId && ctx.state.data.ownerId) {
    try {
      await ctx.client.editText(ctx.state.data.ownerId, messageId, text, undefined, ctx.signal)
    } catch (error) {
      if (!(error instanceof TelegramApiError)) {
        throw error
      }
      if (error.messageMissing || error.topicMissing) {
        messageId = undefined
      } else if (!error.messageNotModified) {
        throw error
      }
    }
  }
  messageId ??= await ctx.text(topic.threadId, text, undefined, { silent: true })
  topic.progress = {
    key: snapshot?.key ?? (sameTurn ? existing.key : 'current'),
    messageId,
    threadId: topic.threadId,
    head: clippedHead,
    text,
    updatedAt: Date.now(),
    settled: status === 'idle' && !pendingStart,
    pendingStart
  }
  await ctx.state.save()
}
