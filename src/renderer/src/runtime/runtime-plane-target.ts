import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { defaultScopeHost } from '@/lib/default-creation-host'
import { taskSourceRuntimeTarget } from '@/lib/task-source-runtime-target'

export type RuntimePlaneSettings =
  | Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
  | TaskSourceContext
  | null
  | undefined

function isTaskSourceRuntimeSettings(
  settings: RuntimePlaneSettings
): settings is TaskSourceContext {
  return settings !== null && settings !== undefined && 'kind' in settings
}

export function getPlaneRuntimeTarget(settings: RuntimePlaneSettings): RuntimeClientTarget {
  return isTaskSourceRuntimeSettings(settings)
    ? taskSourceRuntimeTarget(settings)
    : defaultScopeHost(settings)
}
