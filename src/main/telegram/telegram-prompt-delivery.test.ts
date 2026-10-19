import { expect, it } from 'vitest'
import { routeTelegramUpdate } from './telegram-update-router'
import { deliverTelegramPrompt } from './telegram-prompt-delivery'
import {
  pendingTelegramResolution,
  telegramTestCallback,
  telegramTestFixture,
  telegramTestItem,
  telegramTestMessage
} from './telegram-test-fixture'

it('fences approval buttons by the prompt revision and refuses answers already given in Orca', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  const item = telegramTestItem({
    kind: 'approval',
    title: 'Approve?',
    detail: 'command',
    options: [{ id: 'once', label: 'Once' }],
    resolution: pendingTelegramResolution
  })
  h.setItems([item])
  await deliverTelegramPrompt(h.ctx, 'session-1', item)
  const action = Object.entries(h.state.data.actions).find(
    ([, value]) => value.action.kind === 'prompt'
  )
  if (!action) {
    throw new Error('approval action missing')
  }
  h.setItems([{ ...item, revision: 2 }])
  await expect(routeTelegramUpdate(h.ctx, telegramTestCallback(action[0], 101))).rejects.toThrow(
    'изменился'
  )
  expect(h.respond).not.toHaveBeenCalled()
  h.setItems([item])
  await routeTelegramUpdate(h.ctx, telegramTestCallback(action[0], 101))
  expect(h.respond).toHaveBeenCalledExactlyOnceWith('session-1', expect.any(String), {
    kind: 'approval',
    itemId: 'item-1',
    expectedRevision: 1,
    optionId: 'once'
  })
})

it('collects grouped answers including free text before sending one host response', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  const item = telegramTestItem({
    kind: 'question',
    question: 'Details',
    options: [],
    resolution: pendingTelegramResolution,
    questions: [
      { id: 'q1', question: 'Pick', multiSelect: false, options: [{ id: 'yes', label: 'Yes' }] },
      {
        id: 'q2',
        question: 'Explain',
        multiSelect: false,
        options: [],
        freeTextInput: { multiline: true }
      }
    ]
  })
  h.setItems([item])
  await deliverTelegramPrompt(h.ctx, 'session-1', item)
  const choice = Object.entries(h.state.data.actions).find(
    ([, value]) => value.action.kind === 'question' && value.action.toggle === 'yes'
  )
  if (!choice) {
    throw new Error('choice missing')
  }
  const callback = telegramTestCallback(choice[0], 101)
  const questionMessageId = Number(Object.keys(h.state.data.replies).at(-1))
  if (callback.callback_query?.message) {
    callback.callback_query.message.message_id = questionMessageId
  }
  await routeTelegramUpdate(h.ctx, callback)
  expect(h.respond).not.toHaveBeenCalled()
  const reply = Object.entries(h.state.data.replies).at(-1)
  if (!reply) {
    throw new Error('reply missing')
  }
  await routeTelegramUpdate(h.ctx, {
    update_id: 30,
    message: telegramTestMessage({
      text: 'My answer',
      reply_to_message: { message_id: Number(reply[0]) }
    })
  })
  expect(h.respond).toHaveBeenCalledExactlyOnceWith('session-1', expect.any(String), {
    kind: 'question',
    itemId: 'item-1',
    expectedRevision: 1,
    answers: [
      { questionId: 'q1', optionIds: ['yes'] },
      { questionId: 'q2', optionIds: [], other: 'My answer' }
    ]
  })
})

it('invalidates the send button when a voice draft is cancelled', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  const voice = telegramTestMessage({ text: undefined, voice: { file_id: 'voice', duration: 1 } })
  h.ctx.client.download = async () => Buffer.from('voice')
  await routeTelegramUpdate(h.ctx, { update_id: 1, message: voice })
  const draft = Object.entries(h.state.data.actions).find(
    ([, value]) => value.action.kind === 'draft'
  )
  const cancel = Object.entries(h.state.data.actions).find(
    ([, value]) => value.action.kind === 'discard'
  )
  if (!draft || !cancel) {
    throw new Error('draft missing')
  }
  await routeTelegramUpdate(h.ctx, telegramTestCallback(cancel[0], 101))
  await routeTelegramUpdate(h.ctx, telegramTestCallback(draft[0], 101))
  expect(h.send).not.toHaveBeenCalled()
})

it('keeps multi-select choices on one card and rejects buttons from its previous state', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  const item = telegramTestItem({
    kind: 'question',
    question: 'Select tools',
    options: [],
    resolution: pendingTelegramResolution,
    questions: [
      {
        id: 'tools',
        question: 'Tools?',
        multiSelect: true,
        options: [
          { id: 'x', label: 'X' },
          { id: 'y', label: 'Y' }
        ]
      }
    ]
  })
  h.setItems([item])
  await deliverTelegramPrompt(h.ctx, 'session-1', item)
  const messageId = Number(Object.keys(h.state.data.replies).at(-1))
  const click = async (key: string) => {
    const update = telegramTestCallback(key, 101)
    if (update.callback_query?.message) {
      update.callback_query.message.message_id = messageId
    }
    await routeTelegramUpdate(h.ctx, update)
  }
  const initial = Object.entries(h.state.data.actions)
  const x = initial.find(
    ([, stored]) => stored.action.kind === 'question' && stored.action.toggle === 'x'
  )
  const staleY = initial.find(
    ([, stored]) => stored.action.kind === 'question' && stored.action.toggle === 'y'
  )
  if (!x || !staleY) {
    throw new Error('choices missing')
  }
  await click(x[0])
  await expect(click(staleY[0])).rejects.toThrow('обновлены')
  const y = Object.entries(h.state.data.actions).find(
    ([, stored]) =>
      stored.action.kind === 'question' &&
      stored.action.toggle === 'y' &&
      stored.action.selected.includes('x')
  )
  if (!y) {
    throw new Error('updated choice missing')
  }
  await click(y[0])
  const done = Object.entries(h.state.data.actions).find(
    ([, stored]) =>
      stored.action.kind === 'question' && stored.action.next && stored.action.selected.length === 2
  )
  if (!done) {
    throw new Error('submit missing')
  }
  await click(done[0])
  expect(h.respond).toHaveBeenCalledExactlyOnceWith('session-1', expect.any(String), {
    kind: 'question',
    itemId: 'item-1',
    expectedRevision: 1,
    answers: [{ questionId: 'tools', optionIds: ['x', 'y'] }]
  })
  expect(h.sent.filter((entry) => entry.method === 'editMessageText')).toHaveLength(2)
})

it('confirms a voice reply as the answer to its question rather than sending a new task', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  const item = telegramTestItem({
    kind: 'question',
    question: 'Explain?',
    options: [],
    freeTextInput: { multiline: true },
    resolution: pendingTelegramResolution
  })
  h.setItems([item])
  await deliverTelegramPrompt(h.ctx, 'session-1', item)
  const messageId = Number(Object.keys(h.state.data.replies).at(-1))
  h.ctx.client.download = async () => Buffer.from('voice')
  await routeTelegramUpdate(h.ctx, {
    update_id: 32,
    message: telegramTestMessage({
      text: undefined,
      voice: { file_id: 'voice', duration: 1 },
      reply_to_message: { message_id: messageId }
    })
  })
  expect(h.respond).not.toHaveBeenCalled()
  const draft = Object.entries(h.state.data.actions).find(
    ([, stored]) => stored.action.kind === 'draft'
  )
  if (!draft) {
    throw new Error('draft missing')
  }
  await routeTelegramUpdate(h.ctx, telegramTestCallback(draft[0], 101))
  expect(h.send).not.toHaveBeenCalled()
  expect(h.respond).toHaveBeenCalledExactlyOnceWith('session-1', expect.any(String), {
    kind: 'question',
    itemId: 'item-1',
    expectedRevision: 1,
    answers: [{ questionId: 'q1', optionIds: [], other: 'Voice task' }]
  })
})
