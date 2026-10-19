import { useState } from 'react'
import { ExternalLink, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import { IntegrationCardDetails, IntegrationCardShell } from './integration-card-shell'
import { useTelegramIntegration } from './use-telegram-integration'

export function TelegramIntegrationCard(): React.JSX.Element {
  const { status, busy, error, perform } = useTelegramIntegration()
  const [token, setToken] = useState('')
  const connect = async () => {
    if (await perform(() => window.api.telegram.configure({ token }))) {
      setToken('')
    }
  }
  const pair = async () => {
    const next = await perform(() => window.api.telegram.pair())
    if (next?.pairingUrl) {
      await window.api.shell.openUrl(next.pairingUrl)
    }
  }
  const statusLabel = !status
    ? translate('telegram.loading', 'Loading…')
    : status.connected && status.ownerId
      ? translate('telegram.connected', 'Connected')
      : status.configured
        ? translate('telegram.setupRequired', 'Setup required')
        : translate('telegram.notConnected', 'Not connected')

  return (
    <IntegrationCardShell
      icon={<Send className="size-5" />}
      name="Telegram"
      description={translate(
        'telegram.description',
        'Continue Orca sessions from your personal bot. Each session has its own topic.'
      )}
      statusLabel={statusLabel}
      statusTone={status?.connected && status.ownerId ? 'connected' : 'neutral'}
      checking={!status && !error}
    >
      <IntegrationCardDetails>
        <p className="text-xs text-muted-foreground">
          {translate(
            'telegram.setupHelp',
            'Create a bot in BotFather and enable Threaded Mode. Keep Orca running to exchange messages, files, and voice notes.'
          )}
        </p>
        <Button
          variant="link"
          size="sm"
          onClick={() => window.api.shell.openUrl('https://t.me/BotFather')}
        >
          <ExternalLink />
          {translate('telegram.botFather', 'Open BotFather')}
        </Button>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void connect()
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="telegram-bot-token">{translate('telegram.token', 'Bot token')}</Label>
            <Input
              id="telegram-bot-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={busy}
              placeholder={
                status?.configured ? translate('telegram.tokenSaved', 'Token saved') : '123456789:…'
              }
            />
          </div>
          {status?.bot ? (
            <div className="space-y-1.5">
              <Label htmlFor="telegram-bot-id">
                {translate('telegram.botId', 'Telegram bot ID')}
              </Label>
              <Input id="telegram-bot-id" readOnly value={String(status.bot.id)} />
              <p className="text-xs text-muted-foreground">@{status.bot.username}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={busy || (!token.trim() && !status?.configured)}
            >
              {status?.configured
                ? translate('telegram.checkBot', 'Save and check bot')
                : translate('telegram.connectBot', 'Connect bot')}
            </Button>
            {status?.configured ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !status.bot?.topicsEnabled}
                  onClick={() => void pair()}
                >
                  {status.ownerId
                    ? translate('telegram.relink', 'Link another Telegram account')
                    : translate('telegram.link', 'Link my Telegram account')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void perform(() => window.api.telegram.disconnect())}
                >
                  {translate('telegram.disconnect', 'Disconnect bot')}
                </Button>
              </>
            ) : null}
          </div>
        </form>
        {status?.configured ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="telegram-notifications">
                {translate('telegram.notifications', 'Notify me when I am away')}
              </Label>
              <Switch
                id="telegram-notifications"
                checked={status.notificationsEnabled}
                disabled={busy}
                onCheckedChange={(enabled) =>
                  void perform(() => window.api.telegram.setNotifications({ enabled }))
                }
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'telegram.awayHelp',
                'Notifications start when the computer is locked or inactive for 3 minutes. Replies to Telegram messages are always delivered.'
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {translate(
                'telegram.voiceHelp',
                'Voice notes use the speech model selected in Orca voice settings. Confirm the transcription before sending.'
              )}
            </p>
            {status.ownerId ? (
              <p className="text-xs text-muted-foreground">
                {translate(
                  'telegram.ownerSummary',
                  'Telegram account: {{ownerId}} · Session topics: {{topicCount}}',
                  { ownerId: status.ownerId, topicCount: status.topicCount }
                )}
              </p>
            ) : null}
          </>
        ) : null}
        {error || status?.error ? (
          <p role="alert" className="text-xs text-destructive">
            {error ?? status?.error}
          </p>
        ) : null}
      </IntegrationCardDetails>
    </IntegrationCardShell>
  )
}
