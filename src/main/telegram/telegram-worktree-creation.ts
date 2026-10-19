import type { TelegramAction } from './telegram-integration-state'
import type { TelegramMessage } from './telegram-bot-schema'
import type { TelegramSessionContext } from './telegram-session-context'

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
      .map((repo) => [ctx.button(repo.name, { kind: 'worktree-repo', repoId: repo.id }, threadId)])
    if (page > 0) {
      rows.push([ctx.button('Назад', { kind: 'new-worktree', page: page - 1 }, threadId)])
    }
    if ((page + 1) * 8 < repos.length) {
      rows.push([ctx.button('Далее', { kind: 'new-worktree', page: page + 1 }, threadId)])
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
  const key = ctx.state.action({ kind: 'worktree-name', repoId: action.repoId }, threadId)
  await ctx.state.save()
  const messageId = await ctx.text(
    threadId,
    'Как назвать новый ворктрии? Ответь на это сообщение названием. В нём будет создана новая сессия Codex.'
  )
  ctx.state.data.replies[String(messageId)] = key
  await ctx.state.save()
  return true
}

export async function answerTelegramWorktreeName(
  ctx: TelegramSessionContext,
  message: TelegramMessage
): Promise<boolean> {
  const key =
    message.reply_to_message && ctx.state.data.replies[String(message.reply_to_message.message_id)]
  const stored = key ? ctx.state.data.actions[key] : undefined
  if (!key || stored?.action.kind !== 'worktree-name') {
    return false
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
  await ctx.text(topic.threadId, 'Новый ворктрии и сессия Codex готовы. Отправь первую задачу.')
  stored.used = true
  await ctx.state.save()
  return true
}
