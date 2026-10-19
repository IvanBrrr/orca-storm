import type { TelegramSessionContext } from './telegram-session-context'
import type { TelegramAction } from './telegram-integration-state'
import { deliverTelegramQuestion, answerTelegramQuestionText } from './telegram-prompt-delivery'

export async function routeOwnerAction(
  ctx: TelegramSessionContext,
  action: TelegramAction,
  key: string,
  threadId?: number,
  updateId = 0,
  messageId?: number
): Promise<void> {
  await ctx.refresh()
  if (action.kind === 'discard') {
    const target = action.target ? ctx.state.data.actions[action.target] : undefined
    if (target?.used) {
      await ctx.text(threadId, 'Черновик уже обработан.')
      return
    }
    if (target) {
      target.used = true
    }
    await ctx.state.save()
    await ctx.text(threadId, 'Отправка отменена.')
    return
  }
  if (action.kind === 'workspaces') {
    await showTelegramWorkspaces(ctx, threadId, action.page)
    return
  }
  if (action.kind === 'create') {
    if (!(await ctx.port.workspaces()).some((workspace) => workspace.id === action.workspace)) {
      throw new Error('Эта рабочая папка больше недоступна.')
    }
    const sessionId = await ctx.port.create(action.workspace, await ctx.operation(`create:${key}`))
    await ctx.refresh()
    const session = ctx.sessions.get(sessionId)
    if (!session) {
      throw new Error('Сессия создана, но пока не появилась в списке Orca. Используй /sessions.')
    }
    const topic = await ctx.topic(session)
    await ctx.text(topic.threadId, 'Новая сессия готова. Отправь первую задачу.')
    return
  }
  if (action.kind === 'status') {
    await showTelegramStatus(ctx, action.sessionId, threadId)
    return
  }
  requireActiveSession(ctx, action.sessionId)
  if (action.kind === 'stop') {
    await ctx.port.stop(action.sessionId, await ctx.operation(`stop:${updateId}`), action.turnId)
    await ctx.text(threadId, 'Запрос остановки передан в Orca.')
  } else if (action.kind === 'draft') {
    ctx.request(action.sessionId)
    if (action.replyToQuestion) {
      const question = ctx.state.data.actions[action.replyToQuestion]
      if (
        !question ||
        question.action.kind !== 'question' ||
        question.used ||
        question.expiresAt < Date.now()
      ) {
        throw new Error('Этот вопрос уже обработан или устарел.')
      }
      const text = action.body.blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
      await answerTelegramQuestionText(ctx, question.action, text)
      question.used = true
      await ctx.state.save()
      return
    }
    const queued = await ctx.port.send(
      action.sessionId,
      await ctx.operation(`draft:${key}`),
      action.body
    )
    await ctx.text(threadId, queued ? 'Сообщение в очереди.' : 'Сообщение принято Orca.')
  } else if (action.kind === 'prompt') {
    const prompt = await ctx.port.prompt(action.sessionId, action.itemId)
    if (
      !prompt ||
      prompt.revision !== action.revision ||
      (prompt.body.kind !== 'approval' && prompt.body.kind !== 'question') ||
      prompt.body.resolution.state !== 'pending'
    ) {
      throw new Error('Этот вопрос уже изменился или на него ответили в Orca.')
    }
    await ctx.port.respond(action.sessionId, await ctx.operation(`prompt:${key}`), {
      kind: action.promptKind,
      itemId: action.itemId,
      expectedRevision: action.revision,
      ...(action.optionId !== undefined ? { optionId: action.optionId } : {}),
      ...(action.answers ? { answers: action.answers } : {})
    })
    await ctx.text(threadId, 'Ответ передан агенту.')
  } else if (action.kind === 'question') {
    await deliverTelegramQuestion(ctx, action, messageId)
  }
}

export function requireActiveSession(ctx: TelegramSessionContext, sessionId: string): void {
  const session = ctx.sessions.get(sessionId)
  if (!session?.visible) {
    throw new Error('Сессия закрыта. Открой её в Orca или создай новую через /new.')
  }
  if (session.agent !== 'codex') {
    throw new Error('В этой версии Telegram поддерживает переписку только с Codex.')
  }
}

export async function showTelegramStatus(
  ctx: TelegramSessionContext,
  sessionId: string,
  threadId?: number
): Promise<void> {
  const session = ctx.sessions.get(sessionId)
  if (!session) {
    throw new Error('Сессия недоступна. Связь с хостом может быть потеряна.')
  }
  const status = !session.visible
    ? 'Закрыта'
    : session.status?.status === 'working'
      ? 'Работает'
      : session.status?.status === 'attention'
        ? 'Ждёт ответа'
        : session.status?.status === 'idle'
          ? 'Ожидает задачу'
          : 'Состояние пока неизвестно'
  await ctx.text(
    threadId,
    `${session.name}\n${status}${session.status?.toolName ? `\nИнструмент: ${session.status.toolName}` : ''}`
  )
}

export async function showTelegramWorkspaces(
  ctx: TelegramSessionContext,
  threadId?: number,
  page = 0
): Promise<void> {
  const workspaces = await ctx.port.workspaces()
  if (!workspaces.length) {
    await ctx.text(threadId, 'Сначала добавь проект или папку в Orca.')
    return
  }
  const rows = workspaces
    .slice(page * 8, (page + 1) * 8)
    .map((workspace) => [
      ctx.button(workspace.name, { kind: 'create', workspace: workspace.id }, threadId)
    ])
  if (page > 0) {
    rows.push([ctx.button('Назад', { kind: 'workspaces', page: page - 1 }, threadId)])
  }
  if ((page + 1) * 8 < workspaces.length) {
    rows.push([ctx.button('Далее', { kind: 'workspaces', page: page + 1 }, threadId)])
  }
  await ctx.state.save()
  await ctx.text(threadId, 'Где создать сессию Codex?', { inline_keyboard: rows })
}
