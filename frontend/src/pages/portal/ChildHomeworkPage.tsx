import { useOutletContext, useParams } from 'react-router-dom'
import { useChildHomework, type PortalChild } from '../../lib/portal'
import { formatDateBS } from '../../lib/format'
import { Badge, EmptyState, Skeleton } from '../../components/ui'
import { IconNotebook, IconPaperclip } from '../../components/icons'

/** The class homework feed — due-date aware so today's work stands out. */
export default function ChildHomeworkPage() {
  const { childId } = useParams()
  const child = useOutletContext<PortalChild>()
  const homework = useChildHomework(childId!)

  if (homework.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    )
  }
  const data = homework.data
  if (!data || data.homework.length === 0) {
    return (
      <EmptyState
        icon={<IconNotebook size={22} />}
        title="No homework posted"
        hint={`Assignments for ${child.first_name}'s class will appear here.`}
      />
    )
  }
  const today = data.today_bs

  return (
    <ul className="space-y-2">
      {data.homework.map((hw) => {
        const dueToday = hw.due_date_bs === today
        const overdue = hw.due_date_bs < today
        return (
          <li key={hw.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{hw.title}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {hw.subject} · {hw.teacher}
                </p>
              </div>
              <Badge tone={dueToday ? 'warning' : overdue ? 'neutral' : 'accent'}>
                {dueToday ? 'Due today' : `Due ${formatDateBS(hw.due_date_bs)}`}
              </Badge>
            </div>
            {hw.description && (
              <p className="mt-2 whitespace-pre-line text-sm text-ink-muted">{hw.description}</p>
            )}
            {hw.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {hw.attachments.map((att) => (
                  <a
                    key={att.url}
                    href={att.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-accent-strong hover:bg-accent-soft"
                  >
                    <IconPaperclip size={14} />
                    <span className="max-w-40 truncate">{att.name}</span>
                  </a>
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
