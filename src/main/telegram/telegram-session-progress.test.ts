import { expect, it, vi } from 'vitest'
import { TelegramApiError } from './telegram-bot-client'
import { syncTelegramSessions } from './telegram-session-sync'
import { projectTelegramSessionProgress } from './telegram-session-progress'
import { telegramTestFixture, telegramTestItem } from './telegram-test-fixture'

it('edits one quiet message during a turn, throttles updates and sends the final reply separately', async () => {
  const h = await telegramTestFixture()
  await syncTelegramSessions(h.ctx)
  h.ctx.request('session-1', true)
  const session = h.sessions[0]!
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'working',
    latestPrompt: 'Task',
    updatedAt: 2
  }
  let lines = Array.from({ length: 120 }, (_, i) => `Line ${i}`)
  h.port.progress = async () => ({ key: 'turn-one', start: 'Task', lines })
  await syncTelegramSessions(h.ctx)
  const topic = h.state.data.topics[session.id]!
  const progress = h.sent.filter((entry) => String(entry.params.text).startsWith('Ход работы'))
  expect(progress).toHaveLength(1)
  expect(progress[0]?.params.disable_notification).toBe(true)
  expect(progress[0]?.params.text).toContain('Line 119')
  expect(progress[0]?.params.text).not.toContain('\nLine 19\n')
  const id = topic.progress!.messageId
  lines = ['New command output']
  await syncTelegramSessions(h.ctx)
  expect(h.sent.some((entry) => entry.method === 'editMessageText')).toBe(false)
  topic.progress!.updatedAt = 0
  await syncTelegramSessions(h.ctx)
  expect(h.sent.filter((entry) => entry.method === 'editMessageText')).toHaveLength(1)
  expect(h.sent.at(-1)?.params).toMatchObject({ message_id: id })
  h.setItems([
    telegramTestItem({
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Final answer' }]
    })
  ])
  session.status.status = 'idle'
  session.updatedAt++
  await syncTelegramSessions(h.ctx)
  expect(
    h.sent.filter(
      (entry) =>
        String(entry.params.text).startsWith('Ход работы') && entry.method === 'sendMessage'
    )
  ).toHaveLength(1)
  expect(
    h.sent.find((entry) => entry.params.text === 'Final answer')?.params.disable_notification
  ).toBe(false)
  expect(topic.progress?.settled).toBe(true)
})

it('recovers a deleted progress message and preserves the tail when the host is unverifiable', async () => {
  const h = await telegramTestFixture()
  h.setAway(true)
  const session = h.sessions[0]!
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'working',
    latestPrompt: 'Task',
    updatedAt: 2
  }
  h.port.progress = async () => ({ key: 'one', start: 'Task', lines: ['Saved output'] })
  await syncTelegramSessions(h.ctx)
  const topic = h.state.data.topics[session.id]!
  const first = topic.progress!.messageId
  topic.progress!.updatedAt = 0
  h.port.progress = async () => ({ key: 'one', start: 'Task', lines: ['More output'] })
  vi.spyOn(h.ctx.client, 'editText').mockRejectedValueOnce(
    new TelegramApiError(400, 1, false, true)
  )
  await syncTelegramSessions(h.ctx)
  expect(topic.progress!.messageId).not.toBe(first)
  session.status = null
  await syncTelegramSessions(h.ctx)
  expect(topic.progress!.text).toContain('Состояние не подтверждено')
  expect(topic.progress!.text).toContain('More output')
  expect(topic.progress!.settled).toBe(false)
})

it('reuses the journal text projection for commentary, commands and results while excluding reasoning', () => {
  const items = [
    telegramTestItem(
      { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'Task' }] },
      'user'
    ),
    telegramTestItem(
      {
        kind: 'message',
        role: 'assistant',
        blocks: [
          { type: 'text', text: 'Checking the code' },
          { type: 'tool-call', name: 'exec', input: { cmd: 'git status' } },
          { type: 'tool-result', output: 'Clean tree' }
        ]
      },
      'agent'
    ),
    telegramTestItem(
      { kind: 'message', role: 'reasoning', blocks: [{ type: 'text', text: 'Private reasoning' }] },
      'reasoning'
    )
  ]
  const progress = projectTelegramSessionProgress(items)
  expect(progress.key).toBe('user')
  expect(progress.lines.join('\n')).toContain('git status')
  expect(progress.lines.join('\n')).toContain('Clean tree')
  expect(progress.lines.join('\n')).not.toContain('Private reasoning')
})

it('still delivers the final answer if reading progress fails', async () => {
  const h = await telegramTestFixture()
  h.setAway(true)
  const session = h.sessions[0]!
  session.status = {
    sessionId: session.id,
    workspaceId: session.workspaceId,
    agent: 'codex',
    status: 'working',
    latestPrompt: 'Task',
    updatedAt: 2
  }
  h.port.progress = async () => ({ key: 'one', start: 'Task', lines: ['Working'] })
  await syncTelegramSessions(h.ctx)
  h.port.progress = async () => {
    throw new Error('terminal read unavailable')
  }
  session.status.status = 'idle'
  session.updatedAt++
  h.setItems([
    telegramTestItem({
      kind: 'message',
      role: 'assistant',
      blocks: [{ type: 'text', text: 'Result' }]
    })
  ])
  await expect(syncTelegramSessions(h.ctx)).rejects.toThrow('terminal read unavailable')
  expect(h.sent.some((entry) => entry.params.text === 'Result')).toBe(true)
})
