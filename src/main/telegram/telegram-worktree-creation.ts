import type { TelegramAction } from './telegram-integration-state'
import type { TelegramMessage } from './telegram-bot-schema'
import type { TelegramSessionContext } from './telegram-session-context'
import { cancelTelegramTextPrompt, telegramTextPromptKey } from './telegram-navigation-input'
import { deliverTelegramNavigationDraft } from './telegram-navigation-draft'

export async function routeTelegramWorktreeAction(
  ctx: TelegramSessionContext,
  action: TelegramAction,
  threadId?: number
): Promise<boolean> {
  if (action.kind === 'new-worktree') {
    const repos = await ctx.port.repositories()
    if (!repos.length) {
      await ctx.text(threadId, 'Сначала добавь Git-репозиторий в Storca.')
      return true
    }
    const page = action.page
    const rows = repos
      .slice(page * 8, (page + 1) * 8)
      .map((repo) => [
        ctx.button(
          repo.name,
          { kind: 'worktree-repo', repoId: repo.id, draftKey: action.draftKey },
          threadId
        )
      ])
    if (page > 0) {
      rows.push([
        ctx.button(
          'Назад',
          { kind: 'new-worktree', page: page - 1, draftKey: action.draftKey },
          threadId
        )
      ])
    }
    if ((page + 1) * 8 < repos.length) {
      rows.push([
        ctx.button(
          'Далее',
          { kind: 'new-worktree', page: page + 1, draftKey: action.draftKey },
          threadId
        )
      ])
    }
    await ctx.state.save()
    await ctx.text(threadId, 'В каком репозитории создать новый ворктрии?', {
      inline_keyboard: rows
    })
    return true
  }
  if (action.kind !== 'worktree-repo') {
    return false
  }
  if (!(await ctx.port.repositories()).some((repo) => repo.id === action.repoId)) {
    throw new Error('Репозиторий больше недоступен. Используй /new.')
  }
  cancelTelegramTextPrompt(ctx, threadId)
  const key = ctx.state.action(
    { kind: 'worktree-name', repoId: action.repoId, draftKey: action.draftKey },
    threadId
  )
  await ctx.state.save()
  const messageId = await ctx.text(
    threadId,
    'Как назвать новый ворктрии? Отправь название следующим сообщением. В нём будет создана новая сессия Codex. /cancel — отмена.',
    { force_reply: true, input_field_placeholder: 'Название нового ворктрии' }
  )
  ctx.state.data.replies[String(messageId)] = key
  await ctx.state.save()
  return true
}

export async function answerTelegramWorktreeName(
  ctx: TelegramSessionContext,
  message: TelegramMessage,
  updateId?: number
): Promise<boolean> {
  const key = telegramTextPromptKey(ctx, message, 'worktree-name', updateId)
  const stored = key ? ctx.state.data.actions[key] : undefined
  if (!key || stored?.action.kind !== 'worktree-name') {
    return false
  }
  if (stored.used && stored.action.answerUpdateId === updateId && updateId !== undefined) {
    return true
  }
  const threadId = message.message_thread_id
  if (stored.used || stored.expiresAt <= Date.now() || stored.threadId !== threadId) {
    await ctx.text(threadId, 'Этот запрос уже обработан или устарел. Используй /new.')
    return true
  }
  const name = message.text?.trim() ?? ''
  if (!name || name.length > 80 || /[\r\n]/.test(name)) {
    await ctx.text(threadId, 'Отправь название одной строкой, от 1 до 80 символов.')
    return true
  }
  if (stored.action.name && stored.action.name !== name) {
    throw new Error('Создание уже началось с другим именем. Для другого ворктрии используй /new.')
  }
  stored.action.name = name
  stored.action.answerUpdateId = updateId
  await ctx.state.save()
  const workspaceId = await ctx.port.createWorkspace(
    stored.action.repoId,
    name,
    await ctx.operation(`worktree:${key}`)
  )
  const sessionId = await ctx.port.create(
    workspaceId,
    await ctx.operation(`worktree-session:${key}`)
  )
  await ctx.refresh()
  const session = ctx.sessions.get(sessionId)
  if (!session) {
    throw new Error('Сессия создана, но пока не появилась в Storca. Используй /sessions.')
  }
  const topic = await ctx.topic(session)
  await ctx.text(
    topic.threadId,
    stored.action.draftKey
      ? 'Новый ворктрии и сессия Codex готовы. Передаю сохранённую задачу.'
      : 'Новый ворктрии и сессия Codex готовы. Отправь первую задачу.'
  )
  await deliverTelegramNavigationDraft(ctx, stored.action.draftKey, session)
  stored.used = true
  await ctx.state.save()
  return true
}
