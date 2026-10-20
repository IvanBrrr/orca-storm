import type { TelegramSession } from './telegram-session-port'

export function recentTelegramSessions(sessions: Iterable<TelegramSession>): TelegramSession[] {
  return [...sessions]
    .filter((session) => session.visible)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
}
