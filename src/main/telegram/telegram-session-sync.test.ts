import { expect, it, vi } from 'vitest'
import { TelegramApiError } from './telegram-bot-client'
import { syncTelegramSessions } from './telegram-session-sync'
import {
  telegramTestFixture,
  telegramTestItem,
  pendingTelegramResolution
} from './telegram-test-fixture'
import type { TelegramSession } from './telegram-session-port'

function setStatus(session: TelegramSession, status: 'idle' | 'working' | 'attention') {
  session.updatedAt++
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: session.agent,
    status,
    latestPrompt: '',
    updatedAt: session.updatedAt
  }
}

it('previews history once, notifies only when away, and does not resend old messages', async () => {
  const h = await telegramTestFixture()
  const old = telegramTestItem({
    kind: 'message',
    role: 'assistant',
    blocks: [{ type: 'text', text: 'old' }]
  })
  h.setItems([old])
  await syncTelegramSessions(h.ctx)
  expect(
    h.sent.filter((entry) => String(entry.params.text).includes('Из истории · Агент\n\nold'))
  ).toHaveLength(1)
  const present = telegramTestItem(
    { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'present' }] },
    'present'
  )
  h.setItems([old, present])
  setStatus(h.sessions[0]!, 'idle')
  await syncTelegramSessions(h.ctx)
  expect(h.sent.some((entry) => entry.params.text === 'present')).toBe(false)
  h.setAway(true)
  const away = telegramTestItem(
    { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'away' }] },
    'away'
  )
  h.setItems([old, present, away])
  setStatus(h.sessions[0]!, 'idle')
  await syncTelegramSessions(h.ctx)
  await syncTelegramSessions(h.ctx)
  expect(h.sent.filter((entry) => entry.params.text === 'away')).toHaveLength(1)
  expect(h.sent.some((entry) => entry.params.text === 'present')).toBe(false)
})

it('delivers an unanswered prompt on departure even without a new status update', async () => {
  const h = await telegramTestFixture()
  const prompt = telegramTestItem({
    kind: 'approval',
    title: 'Run command?',
    detail: 'pnpm test',
    options: [{ id: 'allow', label: 'Allow' }],
    resolution: pendingTelegramResolution
  })
  h.setItems([prompt])
  setStatus(h.sessions[0]!, 'attention')
  await syncTelegramSessions(h.ctx)
  expect(h.sent.some((entry) => String(entry.params.text).includes('Run command?'))).toBe(false)
  h.setAway(true)
  await syncTelegramSessions(h.ctx)
  await syncTelegramSessions(h.ctx)
  expect(h.sent.filter((entry) => String(entry.params.text).includes('Run command?'))).toHaveLength(
    1
  )
})

it('always answers Telegram-initiated turns and waits for streamed prose to settle', async () => {
  const h = await telegramTestFixture()
  await syncTelegramSessions(h.ctx)
  h.ctx.requested.add('session-1')
  setStatus(h.sessions[0]!, 'working')
  const message = telegramTestItem({
    kind: 'message',
    role: 'assistant',
    blocks: [{ type: 'text', text: 'partial' }],
    state: 'running'
  })
  h.setItems([message])
  await syncTelegramSessions(h.ctx)
  expect(h.sent.some((entry) => entry.params.text === 'partial')).toBe(false)
  h.setItems([
    telegramTestItem({
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'finished' }],
      state: 'completed'
    })
  ])
  setStatus(h.sessions[0]!, 'idle')
  await syncTelegramSessions(h.ctx)
  expect(h.sent.filter((entry) => entry.params.text === 'finished')).toHaveLength(1)
})

it('removes a closed session topic and suppresses subsequent messages', async () => {
  const h = await telegramTestFixture()
  h.setAway(true)
  await syncTelegramSessions(h.ctx)
  h.sessions[0]!.visible = false
  h.setItems([
    telegramTestItem({
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'closed response' }]
    })
  ])
  await syncTelegramSessions(h.ctx)
  expect(h.state.data.topics['session-1']).toBeUndefined()
  expect(h.sent.some((entry) => entry.params.text === 'closed response')).toBe(false)
  expect(h.sent.filter((entry) => entry.method === 'deleteForumTopic')).toHaveLength(1)
})

it('recreates a deleted topic without resetting its delivery baseline', async () => {
  const h = await telegramTestFixture()
  const topic = await h.ctx.topic(h.sessions[0]!)
  topic.seen.push('message:already-delivered')
  vi.spyOn(h.ctx.client, 'text').mockRejectedValueOnce(new TelegramApiError(400, 1, true))
  await h.ctx.text(topic.threadId, 'A new reply')
  expect(topic.threadId).not.toBe(101)
  expect(topic.seen).toContain('message:already-delivered')
  expect(h.sent.at(-1)?.params.message_thread_id).toBe(topic.threadId)
})

it('does not let one unreadable session prevent notifications from another', async () => {
  const h = await telegramTestFixture()
  const first = h.sessions[0]!
  const second = { ...first, id: 'session-2', name: 'Second' }
  h.sessions.push(second)
  await syncTelegramSessions(h.ctx)
  h.setAway(true)
  setStatus(first, 'idle')
  setStatus(second, 'idle')
  h.port.history = async (id) => {
    if (id === first.id) {
      throw new Error('session journal unavailable')
    }
    return [
      telegramTestItem({
        kind: 'message',
        role: 'assistant',
        blocks: [{ type: 'text', text: 'Second session reply' }]
      })
    ]
  }
  await expect(syncTelegramSessions(h.ctx)).rejects.toThrow('journal unavailable')
  expect(h.sent.some((entry) => entry.params.text === 'Second session reply')).toBe(true)
})

it('notifies about a failed turn even when the agent produced no prose', async () => {
  const h = await telegramTestFixture()
  await syncTelegramSessions(h.ctx)
  h.setAway(true)
  const session = h.sessions[0]!
  setStatus(session, 'idle')
  if (session.status) {
    session.status.turnOutcome = 'failure'
  }
  await syncTelegramSessions(h.ctx)
  await syncTelegramSessions(h.ctx)
  expect(
    h.sent.filter((entry) => String(entry.params.text).startsWith('Агент сообщил об ошибке'))
  ).toHaveLength(1)
})

it('keeps Telegram delivery enabled while another message is queued', async () => {
  const h = await telegramTestFixture()
  await syncTelegramSessions(h.ctx)
  h.ctx.request('session-1')
  h.port.hasPendingMessages = async () => true
  h.setItems([
    telegramTestItem({
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'First result' }]
    })
  ])
  setStatus(h.sessions[0]!, 'idle')
  await syncTelegramSessions(h.ctx)
  expect(h.ctx.requested.has('session-1')).toBe(true)
  h.port.hasPendingMessages = async () => false
  h.setItems([
    telegramTestItem(
      { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: 'Second result' }] },
      'second-result'
    )
  ])
  setStatus(h.sessions[0]!, 'idle')
  await syncTelegramSessions(h.ctx)
  expect(h.sent.some((entry) => entry.params.text === 'Second result')).toBe(true)
  expect(h.ctx.requested.has('session-1')).toBe(false)
})

it('names topics after the workspace and conversation and renames the existing topic', async () => {
  const h = await telegramTestFixture()
  const session = h.sessions[0]!
  session.workspaceName = 'ВПН ФЕЙЛ КЛОСЕД'
  session.name = 'Проработать концепцию VPN'
  await h.ctx.refresh()
  const topic = await h.ctx.topic(session)
  expect(topic.name).toBe('ВПН ФЕЙЛ КЛОСЕД · Проработать концепцию VPN')
  const thread = topic.threadId
  session.workspaceName = 'VPN'
  session.name = 'Новая тема беседы'
  await h.ctx.topic(session)
  expect(topic.threadId).toBe(thread)
  expect(topic.name).toBe('VPN · Новая тема беседы')
})
