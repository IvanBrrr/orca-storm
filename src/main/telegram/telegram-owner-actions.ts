import type { TelegramSessionContext } from './telegram-session-context'
import type { TelegramAction } from './telegram-integration-state'
import { deliverTelegramQuestion, answerTelegramQuestionText } from './telegram-prompt-delivery'
import { sendTelegramPreparedMessage } from './telegram-input-delivery'
import { routeTelegramWorktreeAction } from './telegram-worktree-creation'
import { routeTelegramSessionNavigation } from './telegram-session-navigation'
import {
  deliverTelegramNavigationDraft,
  latestTelegramNavigationDraft
} from './telegram-navigation-draft'
import { cancelTelegramTextPrompt } from './telegram-navigation-input'
import { telegramSessionStatus } from './telegram-session-catalog'

export async function routeOwnerAction(
  ctx: TelegramSessionContext,
  action: TelegramAction,
  key: string,
  threadId?: number,
  updateId = 0,
  messageId?: number
): Promise<void> {
  if (await routeTelegramSessionNavigation(ctx, action, threadId, messageId)) {
    return
  }
  await ctx.refresh()
  if (await routeTelegramWorktreeAction(ctx, action, threadId)) {
    return
  }
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
    await showTelegramWorkspaces(ctx, threadId, action.page, action.draftKey, messageId)
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
      throw new Error('Сессия создана, но пока не появилась в списке Storca. Используй /sessions.')
    }
    const topic = await ctx.topic(session)
    await ctx.text(
      topic.threadId,
      action.draftKey
        ? 'Новая сессия готова. Передаю сохранённую задачу.'
        : 'Новая сессия готова. Отправь первую задачу.'
    )
    await deliverTelegramNavigationDraft(ctx, action.draftKey, session)
    return
  }
  if (action.kind === 'status') {
    await showTelegramStatus(ctx, action.sessionId, threadId)
    return
  }
  if (!('sessionId' in action)) {
    throw new Error('Ответь названием на сообщение бота или используй /new.')
  }
  requireActiveSession(ctx, action.sessionId)
  if (action.kind === 'stop') {
    await ctx.port.stop(action.sessionId, await ctx.operation(`stop:${updateId}`), action.turnId)
    await ctx.text(threadId, 'Запрос остановки передан в Storca.')
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
    const session = ctx.sessions.get(action.sessionId)
    if (!session || !threadId) {
      throw new Error('Тема сессии недоступна.')
    }
    await sendTelegramPreparedMessage(
      ctx,
      session,
      key,
      action.operationId ?? (await ctx.operation(`draft:${key}`)),
      threadId
    )
  } else if (action.kind === 'prompt') {
    const prompt = await ctx.port.prompt(action.sessionId, action.itemId)
    if (
      !prompt ||
      prompt.revision !== action.revision ||
      (prompt.body.kind !== 'approval' && prompt.body.kind !== 'question') ||
      prompt.body.resolution.state !== 'pending'
    ) {
      throw new Error('Этот вопрос уже изменился или на него ответили в Storca.')
    }
    await ctx.port.respond(action.sessionId, await ctx.operation(`prompt:${key}`), {
      kind: action.promptKind,
      itemId: action.itemId,
      expectedRevision: action.revision,
      ...(action.optionId !== undefined ? { optionId: action.optionId } : {}),
      ...(action.answers ? { answers: action.answers } : {})
    })
    ctx.request(action.sessionId, true)
    await ctx.state.save()
    await ctx.text(threadId, 'Ответ передан агенту.')
  } else if (action.kind === 'question') {
    await deliverTelegramQuestion(ctx, action, messageId)
  }
}

export function requireActiveSession(ctx: TelegramSessionContext, sessionId: string): void {
  const session = ctx.sessions.get(sessionId)
  if (!session?.visible) {
    throw new Error('Сессия закрыта. Открой её в Storca или создай новую через /new.')
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
  const status = telegramSessionStatus(session)
  await ctx.text(
    threadId,
    `${session.name}\n${status}${session.status?.toolName ? `\nИнструмент: ${session.status.toolName}` : ''}`
  )
}

export async function showTelegramWorkspaces(
  ctx: TelegramSessionContext,
  threadId?: number,
  page = 0,
  draftKey?: string,
  messageId?: number
): Promise<void> {
  cancelTelegramTextPrompt(ctx, threadId)
  draftKey ??= latestTelegramNavigationDraft(ctx, threadId)
  const workspaces = await ctx.port.workspaces()
  const sorted = [...workspaces].sort((a, b) => (b.activityAt ?? 0) - (a.activityAt ?? 0))
  const rows = sorted
    .slice(page * 8, (page + 1) * 8)
    .map((workspace) => [
      ctx.button(workspace.name, { kind: 'create', workspace: workspace.id, draftKey }, threadId)
    ])
  rows.unshift(
    [ctx.button('Новый ворктрии', { kind: 'new-worktree', page: 0, draftKey }, threadId)],
    [
      ctx.button(
        'Продолжить существующую сессию',
        { kind: 'sessions', page: 0, draftKey },
        threadId
      )
    ]
  )
  if (page > 0) {
    rows.push([ctx.button('Назад', { kind: 'workspaces', page: page - 1, draftKey }, threadId)])
  }
  if ((page + 1) * 8 < workspaces.length) {
    rows.push([ctx.button('Далее', { kind: 'workspaces', page: page + 1, draftKey }, threadId)])
  }
  await ctx.menu(threadId, messageId, 'Где создать сессию Codex?', { inline_keyboard: rows })
}
