import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { MonitorAccountScope } from './work-monitor-account-scopes'

export function WorkMonitorAccountPicker({
  scopes,
  logins,
  onChange
}: {
  scopes: MonitorAccountScope[]
  logins: Readonly<Record<string, string>>
  onChange: (scope: string, login: string) => void
}): React.JSX.Element | null {
  const [selected, setSelected] = useState('')
  const account = scopes.find((scope) => scope.key === selected) ?? scopes[0]
  if (!account) {
    return null
  }
  return (
    <>
      {scopes.length > 1 ? (
        <div className="space-y-2">
          <Label htmlFor="work-monitor-account">
            {translate('workMonitor.accountSource', 'GitHub account source')}
          </Label>
          <Select value={account.key} onValueChange={setSelected}>
            <SelectTrigger id="work-monitor-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scopes.map((scope) => (
                <SelectItem key={scope.key} value={scope.key}>
                  {scope.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="work-monitor-login">
          {translate('workMonitor.myLoginForHost', 'My GitHub login · {{host}}', {
            host: account.host
          })}
        </Label>
        <Input
          id="work-monitor-login"
          value={logins[account.key] ?? ''}
          onChange={(event) => onChange(account.key, event.target.value)}
          placeholder="octocat"
          autoComplete="off"
        />
      </div>
    </>
  )
}
