import { useEffect, useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { translate } from '@/i18n/i18n'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { WorkMonitor } from '../work-monitor/WorkMonitor'
import TaskListPage from './TaskListPage'

type WorkView = 'attention' | 'team' | 'tasks'

export default function TaskPage(): React.JSX.Element {
  useTranslation()
  const pageData = useAppStore((s) => s.taskPageData)
  const hasExplicitTarget = Object.keys(pageData).length > 0
  const [view, setView] = useState<WorkView>(hasExplicitTarget ? 'tasks' : 'attention')
  useEffect(() => {
    if (Object.keys(pageData).length > 0) {
      setView('tasks')
    }
  }, [pageData])
  const changeView = (value: string): void => {
    if (value === 'attention' || value === 'team' || value === 'tasks') {
      setView(value)
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-background text-foreground">
      <Tabs value={view} onValueChange={changeView} className="min-h-0 flex-1">
        <div className="px-5 py-3 md:px-8">
          <TabsList aria-label={translate('workMonitor.views', 'Work views')}>
            <TabsTrigger value="attention">
              {translate('workMonitor.attention', 'My attention')}
            </TabsTrigger>
            <TabsTrigger value="team">{translate('workMonitor.team', 'Team')}</TabsTrigger>
            <TabsTrigger value="tasks">{translate('workMonitor.tasks', 'Task list')}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value={view} className="flex min-h-0 flex-1 flex-col">
          {view === 'tasks' ? <TaskListPage /> : <WorkMonitor view={view} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}
