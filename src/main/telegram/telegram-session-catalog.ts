import type { TelegramSessionContext } from './telegram-session-context'
import { telegramTopicName } from './telegram-session-context'
import type { TelegramSession } from './telegram-session-port'
import { telegramHistoryText } from './telegram-session-history'
import { latestTelegramNavigationDraft } from './telegram-navigation-draft'
import type { TelegramKeyboard } from './telegram-bot-schema'

export type TelegramCatalogOptions = {
  page?: number
  query?: string
  draftKey?: string
  messageId?: number
}

export function telegramSessionStatus(session: TelegramSession): string {
  return !session.visible
    ? 'Закрыта'
    : session.status?.status === 'working'
      ? 'Работает'
      : session.status?.status === 'attention'
        ? 'Ждёт ответа'
        : session.status?.status === 'idle'
          ? 'Ожидает задачу'
          : 'Состояние пока неизвестно'
}

function searchText(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е')
}

export function telegramNavigationDraftPreview(ctx: TelegramSessionContext, key?: string): string {
  const stored = key ? ctx.state.data.actions[key] : undefined
  if (!stored || stored.used || stored.action.kind !== 'route-draft') {
    return ''
  }
  const message = stored.action.message
  const text =
    message.text ??
    message.caption ??
    (message.voice ? 'Голосовое сообщение' : (message.document?.file_name ?? 'Вложение'))
  return `\n\nЗадача сохранена:\n${Array.from(text).slice(0, 400).join('')}`
}

export async function showTelegramSessions(
  ctx: TelegramSessionContext,
  threadId?: number,
  options: TelegramCatalogOptions = {}
): Promise<void> {
  await ctx.refresh()
  const query = options.query?.trim().slice(0, 120) ?? ''
  const words = searchText(query).split(/\s+/).filter(Boolean)
  const visible = [...ctx.sessions.values()].filter((session) => session.visible)
  const sessions = visible
    .filter((session) =>
      words.every((word) =>
        searchText(`${session.workspaceName ?? ''} ${session.name} ${session.agent}`).includes(word)
      )
    )
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
  const pages = Math.max(1, Math.ceil(sessions.length / 10))
  const page = Math.max(0, Math.min(options.page ?? 0, pages - 1))
  const draftKey = options.draftKey ?? latestTelegramNavigationDraft(ctx, threadId)
  const rows = [[ctx.button('Найти сессию', { kind: 'session-search', draftKey }, threadId)]]
  for (const session of sessions.slice(page * 10, (page + 1) * 10)) {
    const state =
      session.status?.status === 'working'
        ? '◉'
        : session.status?.status === 'attention'
          ? '!'
          : '○'
    rows.push([
      ctx.button(
        `${state} ${telegramTopicName(session)}`,
        { kind: 'session-select', sessionId: session.id, page, query, draftKey },
        threadId
      )
    ])
  }
  const navigation: TelegramKeyboard['inline_keyboard'][number] = []
  if (page > 0) {
    navigation.push(
      ctx.button('Назад', { kind: 'sessions', page: page - 1, query, draftKey }, threadId)
    )
  }
  if (page + 1 < pages) {
    navigation.push(
      ctx.button('Далее', { kind: 'sessions', page: page + 1, query, draftKey }, threadId)
    )
  }
  if (navigation.length) {
    rows.push(navigation)
  }
  if (query) {
    rows.push([ctx.button('Все сессии', { kind: 'sessions', page: 0, draftKey }, threadId)])
  }
  rows.push([ctx.button('Новая сессия', { kind: 'workspaces', page: 0, draftKey }, threadId)])
  const heading = `Сессий Storca: ${visible.length}. ${query ? `Найдено: ${sessions.length}.\nПоиск: ${query}` : 'Сначала недавние.'}\nСтраница ${page + 1} из ${pages}.`
  const empty = sessions.length
    ? ''
    : query
      ? '\nНичего не найдено. Измени запрос или покажи все сессии.'
      : '\nСоздай новую сессию или открой её в Storca.'
  await ctx.menu(
    threadId,
    options.messageId,
    `${heading}${empty}${telegramNavigationDraftPreview(ctx, draftKey)}`,
    { inline_keyboard: rows }
  )
}

export async function showTelegramSessionCard(
  ctx: TelegramSessionContext,
  sessionId: string,
  threadId: number | undefined,
  options: TelegramCatalogOptions
): Promise<void> {
  await ctx.refresh()
  const session = ctx.sessions.get(sessionId)
  if (!session?.visible) {
    await showTelegramSessions(ctx, threadId, options)
    return
  }
  let context = ''
  if (session.agent === 'codex') {
    try {
      const history = ctx.port.recentHistory
        ? await ctx.port.recentHistory(session.id, ctx.signal)
        : await ctx.port.history(session.id)
      if (history) {
        const messages = history.filter((item) => telegramHistoryText(item))
        const user = messages.findLast(
          (item) => item.body.kind === 'message' && item.body.role === 'user'
        )
        const assistant = messages.findLast(
          (item) => item.body.kind === 'message' && item.body.role === 'assistant'
        )
        if (user) {
          context += `\n\nПоследняя задача:\n${Array.from(telegramHistoryText(user)).slice(0, 500).join('')}`
        }
        if (assistant) {
          context += `\n\nПоследний ответ:\n${Array.from(telegramHistoryText(assistant)).slice(0, 700).join('')}`
        }
      }
    } catch {
      ctx.signal.throwIfAborted()
      context = '\n\nПоследние сообщения пока недоступны.'
    }
  }
  const rows: TelegramKeyboard['inline_keyboard'] = []
  if (!options.draftKey || session.agent === 'codex') {
    rows.push([
      ctx.button(
        options.draftKey ? 'Отправить задачу в эту сессию' : 'Продолжить сессию',
        { kind: 'session-open', sessionId, draftKey: options.draftKey },
        threadId
      )
    ])
  }
  rows.push([
    ctx.button(
      'Назад к списку',
      {
        kind: 'sessions',
        page: options.page ?? 0,
        query: options.query,
        draftKey: options.draftKey
      },
      threadId
    )
  ])
  const supported =
    session.agent === 'codex' ? '' : '\nПереписка через Telegram пока доступна для Codex.'
  await ctx.menu(
    threadId,
    options.messageId,
    `${telegramTopicName(session)}\n${session.agent} · ${telegramSessionStatus(session)}${supported}${context}${telegramNavigationDraftPreview(ctx, options.draftKey)}`,
    { inline_keyboard: rows }
  )
}
