import { useEffect, useState } from 'react'
import type { PRComment } from '../../../../shared/github/comment-types'
import { mapSettledWithConcurrency } from '../../../../shared/map-with-concurrency'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import { getTaskPageRepoSourceContext } from '../task-page-source-context'
import type { MonitorRow } from './work-monitor-model'

type ActivityComment = { prUrl: string; number: number; comment: PRComment }

export function WorkMonitorActivity({ row }: { row: MonitorRow }): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const [activity, setActivity] = useState<{
    rowId: string
    comments: ActivityComment[]
    failed: boolean
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    void mapSettledWithConcurrency(row.prs, 3, async (pr) => {
      const repo = repos.find((r) => r.id === pr.repoId)
      if (!repo) {
        throw new Error('Repository no longer available')
      }
      const comments = await useAppStore.getState().fetchPRComments(repo.path, pr.number, {
        repoId: repo.id,
        sourceContext: getTaskPageRepoSourceContext(repo, 'github'),
        prRepo: pr.prRepo
      })
      return comments.map((comment) => ({ prUrl: pr.url, number: pr.number, comment }))
    }).then((results) => {
      if (!cancelled) {
        setActivity({
          rowId: row.id,
          comments: results
            .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
            .sort((a, b) => b.comment.createdAt.localeCompare(a.comment.createdAt)),
          failed: results.some((r) => r.status === 'rejected')
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [row, repos])
  const current = activity?.rowId === row.id ? activity : null
  const unresolved = new Set(
    current?.comments
      .filter((entry) => entry.comment.threadId && entry.comment.isResolved === false)
      .map((entry) => `${entry.prUrl}:${entry.comment.threadId}`)
  ).size
  return (
    <section className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-medium">
        {translate('workMonitor.activity', 'Recent PR comments')}
      </h3>
      {!current ? (
        <p className="text-xs text-muted-foreground">
          {translate('workMonitor.loadingComments', 'Loading comments…')}
        </p>
      ) : (
        <>
          {current.failed ? (
            <p role="alert" className="text-xs text-destructive">
              {translate(
                'workMonitor.commentsUnavailable',
                'Some PR comments could not be loaded.'
              )}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {translate(
              'workMonitor.unresolved',
              '{{count}} unresolved review threads in loaded comments',
              { count: unresolved }
            )}
          </p>
          <ol className="space-y-3">
            {current.comments.slice(0, 8).map(({ prUrl, number, comment }) => (
              <li key={`${prUrl}:${comment.id}`} className="space-y-1 text-xs">
                <p>
                  {comment.author} · PR #{number} ·{' '}
                  {formatUiRelativeTimeFromDate(comment.createdAt)}
                </p>
                <p className="line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">
                  {comment.body}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
