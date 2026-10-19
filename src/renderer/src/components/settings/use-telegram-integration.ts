import { useCallback, useEffect, useRef, useState } from 'react'
import type { TelegramIntegrationStatus } from '../../../../shared/telegram-integration'
import { translate } from '@/i18n/i18n'

export function useTelegramIntegration() {
  const [status, setStatus] = useState<TelegramIntegrationStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = useRef(0)
  const mounted = useRef(false)
  const pending = useRef(false)

  useEffect(() => {
    mounted.current = true
    let disposed = false
    let refreshing = false
    const refresh = async () => {
      if (refreshing || disposed) {
        return
      }
      refreshing = true
      const version = revision.current
      if (!pending.current) {
        try {
          const next = await window.api.telegram.status()
          if (!disposed && version === revision.current) {
            setStatus(next)
          }
        } catch {
          if (!disposed && version === revision.current) {
            setError(
              translate(
                'telegram.unavailable',
                'Telegram settings are unavailable. Try reopening settings.'
              )
            )
          }
        }
      }
      refreshing = false
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => {
      disposed = true
      mounted.current = false
      clearInterval(timer)
    }
  }, [])

  const perform = useCallback(
    async (
      work: () => Promise<TelegramIntegrationStatus>
    ): Promise<TelegramIntegrationStatus | null> => {
      if (pending.current) {
        return null
      }
      pending.current = true
      revision.current++
      setBusy(true)
      setError(null)
      try {
        const next = await work()
        if (mounted.current) {
          setStatus(next)
        }
        return next
      } catch (cause) {
        if (mounted.current) {
          setError(
            cause instanceof Error
              ? cause.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
              : translate('telegram.failed', 'Telegram request failed.')
          )
        }
        return null
      } finally {
        pending.current = false
        if (mounted.current) {
          setBusy(false)
        }
      }
    },
    []
  )
  return { status, busy, error, perform }
}
