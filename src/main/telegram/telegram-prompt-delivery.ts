import type { AgentJournalRenderItem } from '../../shared/agent-session-journal-types'
import { isNewerApprovalSubject } from '../../shared/agent-session-approval-subject'
import { agentSessionPromptQuestions } from '../../shared/agent-session-question-answer'
import type { TelegramAction } from './telegram-integration-state'
import type { TelegramSessionContext } from './telegram-session-context'

export async function deliverTelegramPrompt(
  ctx: TelegramSessionContext,
  sessionId: string,
  item: AgentJournalRenderItem
): Promise<void> {
  const topic = ctx.state.data.topics[sessionId]
  if (!topic) {
    return
  }
  const body = item.body
  if (
    (body.kind !== 'approval' && body.kind !== 'question') ||
    body.resolution.state !== 'pending'
  ) {
    return
  }
  if (body.kind === 'question') {
    await deliverTelegramQuestion(ctx, {
      kind: 'question',
      sessionId,
      itemId: item.itemId,
      revision: item.revision,
      index: 0,
      answers: [],
      selected: []
    })
    return
  }
  if (isNewerApprovalSubject(body.subject)) {
    await ctx.text(
      topic.threadId,
      `${body.title}\n\nЭтот тип запроса нужно открыть в Storca.\n${body.detail ?? ''}`
    )
    return
  }
  const keyboard = {
    inline_keyboard: body.options.map((option) => [
      ctx.button(
        option.label,
        {
          kind: 'prompt',
          sessionId,
          itemId: item.itemId,
          revision: item.revision,
          promptKind: 'approval',
          optionId: option.id
        },
        topic.threadId
      )
    ])
  }
  await ctx.state.save()
  const subject =
    body.subject && 'text' in body.subject && typeof body.subject.text === 'string'
      ? body.subject.text
      : ''
  await ctx.text(
    topic.threadId,
    [body.title, body.description, body.detail, body.decisionReason, body.blockedPath, subject]
      .filter(Boolean)
      .join('\n\n'),
    keyboard
  )
}

export async function deliverTelegramQuestion(
  ctx: TelegramSessionContext,
  action: Extract<TelegramAction, { kind: 'question' }>,
  messageId?: number
): Promise<void> {
  const item = await ctx.port.prompt(action.sessionId, action.itemId)
  if (
    !item ||
    item.revision !== action.revision ||
    item.body.kind !== 'question' ||
    item.body.resolution.state !== 'pending'
  ) {
    throw new Error('Этот вопрос уже изменился или на него ответили в Storca.')
  }
  const questions = agentSessionPromptQuestions(item.body)
  const question = questions[action.index]
  const topic = ctx.state.data.topics[action.sessionId]
  if (!question || !topic) {
    throw new Error('Вопрос недоступен.')
  }
  if (messageId && (action.toggle || action.next)) {
    const displayedKey = ctx.state.data.replies[String(messageId)]
    const displayed = displayedKey ? ctx.state.data.actions[displayedKey]?.action : undefined
    if (
      displayed?.kind === 'question' &&
      (displayed.index !== action.index ||
        JSON.stringify(displayed.selected) !== JSON.stringify(action.selected))
    ) {
      throw new Error('Варианты уже обновлены. Используй кнопки текущего вопроса.')
    }
  }
  let selected = action.selected
  if (action.toggle) {
    if (!question.options.some((option) => option.id === action.toggle)) {
      throw new Error('Вариант ответа недоступен.')
    }
    selected = question.multiSelect
      ? selected.includes(action.toggle)
        ? selected.filter((id) => id !== action.toggle)
        : [...selected, action.toggle]
      : [action.toggle]
  }
  if ((action.toggle && !question.multiSelect) || action.next) {
    if (!selected.length) {
      throw new Error('Выбери хотя бы один вариант ответа.')
    }
    const answers = [...action.answers, { questionId: question.id, optionIds: selected }]
    if (action.index + 1 === questions.length) {
      await ctx.port.respond(
        action.sessionId,
        await ctx.operation(`question:${action.itemId}:${action.revision}`),
        {
          kind: 'question',
          itemId: action.itemId,
          expectedRevision: action.revision,
          answers
        }
      )
      await ctx.text(topic.threadId, 'Ответ передан агенту.')
      return
    }
    await deliverTelegramQuestion(
      ctx,
      {
        ...action,
        index: action.index + 1,
        answers,
        selected: [],
        toggle: undefined,
        next: undefined
      },
      messageId
    )
    return
  }
  const base = { ...action, selected, toggle: undefined, next: undefined }
  const rows = question.options.map((option) => [
    ctx.button(
      `${selected.includes(option.id) ? '✓ ' : ''}${option.label}`,
      { ...base, toggle: option.id },
      topic.threadId
    )
  ])
  if (question.multiSelect) {
    rows.push([ctx.button('Готово', { ...base, next: true }, topic.threadId)])
  }
  const replyAction = ctx.state.action(base, topic.threadId)
  await ctx.state.save()
  const hint =
    question.freeTextInput || question.freeTextQuestionId
      ? '\nОтветь на это сообщение своим текстом или выбери вариант.'
      : ''
  const options = question.options
    .map((option) => `${option.label}${option.description ? `: ${option.description}` : ''}`)
    .join('\n')
  const text = `${action.index + 1}/${questions.length}. ${question.question}\n${options}${hint}`
  let displayedMessageId = messageId
  const ownerId = ctx.state.data.ownerId
  if (displayedMessageId && ownerId && text.length <= 3500) {
    await ctx.client.editText(
      ownerId,
      displayedMessageId,
      text,
      { inline_keyboard: rows },
      ctx.signal
    )
  } else {
    displayedMessageId = await ctx.text(topic.threadId, text, { inline_keyboard: rows })
  }
  ctx.state.data.replies[String(displayedMessageId)] = replyAction
  await ctx.state.save()
}

export async function answerTelegramQuestionText(
  ctx: TelegramSessionContext,
  action: Extract<TelegramAction, { kind: 'question' }>,
  text: string
): Promise<void> {
  const item = await ctx.port.prompt(action.sessionId, action.itemId)
  if (
    !item ||
    item.body.kind !== 'question' ||
    item.revision !== action.revision ||
    item.body.resolution.state !== 'pending'
  ) {
    throw new Error('Этот вопрос уже изменился или на него ответили в Storca.')
  }
  const questions = agentSessionPromptQuestions(item.body)
  const question = questions[action.index]
  if (!question || (!question.freeTextInput && !question.freeTextQuestionId)) {
    throw new Error('Для этого вопроса нужно выбрать вариант кнопкой.')
  }
  const answers = [...action.answers, { questionId: question.id, optionIds: [], other: text }]
  if (action.index + 1 < questions.length) {
    await deliverTelegramQuestion(ctx, {
      ...action,
      index: action.index + 1,
      answers,
      selected: [],
      toggle: undefined,
      next: undefined
    })
    return
  }
  await ctx.port.respond(
    action.sessionId,
    await ctx.operation(`question:${action.itemId}:${action.revision}`),
    {
      kind: 'question',
      itemId: action.itemId,
      expectedRevision: action.revision,
      answers
    }
  )
  await ctx.text(ctx.state.data.topics[action.sessionId]?.threadId, 'Ответ передан агенту.')
}
