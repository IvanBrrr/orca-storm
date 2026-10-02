import type { TaskPageJiraIssueCreationModel } from './use-task-page-jira-issue-creation'
import { useEffect } from 'react'
export function useTaskPageGlobalEffects(model: TaskPageJiraIssueCreationModel) {
  const {
    linearStatusContextKey,
    preflightStatusChecked,
    preflightStatusContextKey,
    checkLinearConnection,
    refreshPreflightStatus,
    expectedPreflightContextKey,
    jiraStatusContextKey,
    checkJiraConnection,
    providerRuntimeContextKey,
    preflightStatusCurrent,
    linearStatusReady,
    jiraStatusReady,
    tasksLoading,
    tasksRefreshing,
    tasksFiltering
  } = model
  const githubTasksBusy = tasksLoading || tasksRefreshing || tasksFiltering
  useEffect(() => {
    if (!preflightStatusCurrent || !preflightStatusChecked) {
      void refreshPreflightStatus()
    }
    if (!linearStatusReady) {
      void checkLinearConnection()
    }
    if (!jiraStatusReady) {
      void checkJiraConnection()
    }
  }, [
    checkJiraConnection,
    checkLinearConnection,
    expectedPreflightContextKey,
    jiraStatusContextKey,
    jiraStatusReady,
    linearStatusContextKey,
    linearStatusReady,
    providerRuntimeContextKey,
    preflightStatusContextKey,
    preflightStatusChecked,
    preflightStatusCurrent,
    refreshPreflightStatus
  ])

  // Why: debounce the Linear search input so we don't fire a request per keystroke (300ms, matching GitHub search).
  const nextModel = model as typeof model & {
    githubTasksBusy: typeof githubTasksBusy
  }
  nextModel.githubTasksBusy = githubTasksBusy
  return nextModel
}
export type TaskPageGlobalEffectsModel = ReturnType<typeof useTaskPageGlobalEffects>
