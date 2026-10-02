import { useEffect, useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { WorkMonitor } from '../work-monitor/WorkMonitor'
import TaskListPage from './TaskListPage'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { X } from 'lucide-react'
import { useTaskPageEscape } from './use-task-page-escape'

type WorkView = 'attention' | 'team' | 'tasks'

export default function TaskPage(): React.JSX.Element {
  useTranslation()
  const pageData = useAppStore((s) => s.taskPageData)
  const closeTaskPage = useAppStore((s) => s.closeTaskPage)
  const activeModal = useAppStore((s) => s.activeModal)
  const activeView = useAppStore((s) => s.activeView)
  useTaskPageEscape(activeModal, closeTaskPage, activeView === 'tasks')
  const hasExplicitTarget = Object.keys(pageData).length > 0
  const [view, setView] = useState<WorkView>(hasExplicitTarget ? 'tasks' : 'attention')
  const [tasksVisited, setTasksVisited] = useState(hasExplicitTarget)
  const [monitorView, setMonitorView] = useState<'attention' | 'team' | null>(
    hasExplicitTarget ? null : 'attention'
  )
  useEffect(() => {
    if (Object.keys(pageData).length > 0) {
      setView('tasks')
      setTasksVisited(true)
    }
  }, [pageData])
  const changeView = (value: string): void => {
    if (value === 'attention' || value === 'team' || value === 'tasks') {
      setView(value)
      if (value === 'tasks') {
        setTasksVisited(true)
      } else {
        setMonitorView(value)
      }
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <Tabs value={view} onValueChange={changeView} className="min-h-0 flex-1">
        <div className="flex items-center gap-3 px-5 py-3 md:px-8">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={closeTaskPage}
                aria-label={translate('auto.components.TaskPage.1a06219d5c', 'Close tasks')}
              >
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {translate('auto.components.TaskPage.4826fd1ad8', 'Close · Esc')}
            </TooltipContent>
          </Tooltip>
          <TabsList aria-label={translate('workMonitor.views', 'Work views')}>
            <TabsTrigger value="attention">
              {translate('workMonitor.attention', 'My attention')}
            </TabsTrigger>
            <TabsTrigger value="team">{translate('workMonitor.team', 'Team')}</TabsTrigger>
            <TabsTrigger value="tasks">{translate('workMonitor.tasks', 'Task list')}</TabsTrigger>
          </TabsList>
        </div>
        {tasksVisited ? (
          <TabsContent
            forceMount
            value="tasks"
            className={view === 'tasks' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          >
            <TaskListPage active={activeView === 'tasks' && view === 'tasks'} />
          </TabsContent>
        ) : null}
        {monitorView ? (
          <TabsContent
            forceMount
            value={monitorView}
            className={view === 'tasks' ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}
          >
            <WorkMonitor view={monitorView} active={activeView === 'tasks' && view !== 'tasks'} />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  )
}
