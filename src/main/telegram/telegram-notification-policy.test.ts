import { expect, it } from 'vitest'
import { syncTelegramSessions } from './telegram-session-sync'
import { routeTelegramUpdate } from './telegram-update-router'
import { TelegramInputNotDeliveredError } from './telegram-input-refusal'
import { telegramTestFixture, telegramTestItem, telegramTestMessage } from './telegram-test-fixture'

function reply(text: string, id: string) {
  return telegramTestItem(
    { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] },
    id
  )
}

it('keeps history, menus, service messages and background answers quiet even when away', async () => {
  const h = await telegramTestFixture()
  h.setItems([reply('Historical message', 'history')])
  await syncTelegramSessions(h.ctx)
  h.setAway(true)
  h.sessions[0]!.updatedAt++
  h.setItems([reply('Historical message', 'history'), reply('Background result', 'background')])
  await syncTelegramSessions(h.ctx)
  await routeTelegramUpdate(h.ctx, {
    update_id: 1,
    message: telegramTestMessage({ text: '/sessions' })
  })
  await h.ctx.text(101, 'Service error')
  expect(
    h.sent
      .filter((s) => s.method === 'sendMessage')
      .every((s) => s.params.disable_notification === true)
  ).toBe(true)
})

it('notifies only for the final reply to an accepted Telegram task and retains the rule after reload', async () => {
  const h = await telegramTestFixture()
  await syncTelegramSessions(h.ctx)
  await routeTelegramUpdate(h.ctx, {
    update_id: 2,
    message: telegramTestMessage({ text: 'My task' })
  })
  await h.state.load()
  const session = h.sessions[0]!
  session.updatedAt++
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'idle',
    latestPrompt: 'My task',
    updatedAt: session.updatedAt
  }
  h.setItems([reply('Checking the code', 'commentary'), reply('Final answer', 'final')])
  await syncTelegramSessions(h.ctx)
  await syncTelegramSessions(h.ctx)
  const audible = h.sent.filter(
    (s) => s.method === 'sendMessage' && s.params.disable_notification === false
  )
  expect(audible.map((s) => s.params.text)).toEqual(['Final answer'])
  expect(h.state.data.topics[session.id]?.notifyReply).toBe(false)
  h.setAway(true)
  session.updatedAt++
  h.setItems([reply('Background after my task', 'later')])
  await syncTelegramSessions(h.ctx)
  expect(h.sent.at(-1)?.params.disable_notification).toBe(true)
})

it('does not make a background result audible after an undelivered Telegram input', async () => {
  const h = await telegramTestFixture()
  await syncTelegramSessions(h.ctx)
  h.send.mockRejectedValueOnce(new TelegramInputNotDeliveredError('Not sent'))
  await routeTelegramUpdate(h.ctx, { update_id: 3, message: telegramTestMessage() })
  const session = h.sessions[0]!
  session.updatedAt++
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'idle',
    latestPrompt: '',
    updatedAt: session.updatedAt
  }
  h.setItems([reply('Old unrelated work', 'old')])
  await syncTelegramSessions(h.ctx)
  expect(
    h.sent
      .filter((s) => s.method === 'sendMessage')
      .every((s) => s.params.disable_notification === true)
  ).toBe(true)
})

it('does not consume a fast first answer as silent backfill before the topic has synchronized', async () => {
  const h = await telegramTestFixture()
  await h.ctx.topic(h.sessions[0]!)
  await routeTelegramUpdate(h.ctx, {
    update_id: 4,
    message: telegramTestMessage({ text: 'Quick task' })
  })
  const session = h.sessions[0]!
  session.updatedAt++
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'idle',
    latestPrompt: 'Quick task',
    updatedAt: session.updatedAt
  }
  h.setItems([reply('Quick final answer', 'quick')])
  await syncTelegramSessions(h.ctx)
  expect(h.sent.filter((s) => s.params.text === 'Quick final answer')).toHaveLength(1)
  expect(
    h.sent.some(
      (s) =>
        String(s.params.text).startsWith('Из истории') &&
        String(s.params.text).includes('Quick final answer')
    )
  ).toBe(false)
  expect(
    h.sent.find((s) => s.params.text === 'Quick final answer')?.params.disable_notification
  ).toBe(false)
})

it('keeps attachments quiet after an audible text answer and notifies once for a file-only answer', async () => {
  const h = await telegramTestFixture()
  await syncTelegramSessions(h.ctx)
  const session = h.sessions[0]!
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'idle',
    latestPrompt: '',
    updatedAt: 1
  }
  h.port.outputFiles = async () => [
    { name: 'a.txt', bytes: Buffer.from('a') },
    { name: 'b.txt', bytes: Buffer.from('b') }
  ]
  h.ctx.request(session.id, true)
  session.updatedAt++
  h.setItems([reply('Answer with files', 'text-files')])
  await syncTelegramSessions(h.ctx)
  const forms = () =>
    h.fetcher.mock.calls.flatMap(([, init]) => (init?.body instanceof FormData ? [init.body] : []))
  expect(forms().map((form) => form.get('disable_notification'))).toEqual(['true', 'true'])
  h.ctx.request(session.id, true)
  session.updatedAt++
  h.setItems([telegramTestItem({ kind: 'message', role: 'assistant', blocks: [] }, 'files-only')])
  await syncTelegramSessions(h.ctx)
  expect(
    forms()
      .slice(-2)
      .map((form) => form.get('disable_notification'))
  ).toEqual(['false', 'true'])
})

it('does not alert for the preceding turn while the Telegram task is still waiting to start', async () => {
  const h = await telegramTestFixture()
  await syncTelegramSessions(h.ctx)
  const session = h.sessions[0]!
  session.turnStartedAt = 1
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'idle',
    latestPrompt: '',
    updatedAt: 1
  }
  let key = 'old'
  h.port.progress = async () => ({ key, start: '', lines: [] })
  h.send.mockResolvedValue(true)
  await routeTelegramUpdate(h.ctx, {
    update_id: 5,
    message: telegramTestMessage({ text: 'Next task' })
  })
  h.setItems([reply('Preceding turn result', 'preceding')])
  await syncTelegramSessions(h.ctx)
  expect(h.sent.some((s) => s.params.disable_notification === false)).toBe(false)
  key = 'new'
  session.status.status = 'working'
  h.state.data.topics[session.id]!.progress!.updatedAt = 0
  await syncTelegramSessions(h.ctx)
  session.status.status = 'idle'
  session.updatedAt++
  h.setItems([reply('My task result', 'mine')])
  await syncTelegramSessions(h.ctx)
  expect(
    h.sent.filter((s) => s.params.disable_notification === false).map((s) => s.params.text)
  ).toEqual(['My task result'])
})
