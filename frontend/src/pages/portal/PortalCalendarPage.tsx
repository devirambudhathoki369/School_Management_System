import { useState } from 'react'
import { usePortalCalendar, shiftMonthBs } from '../../lib/portal'
import { bsMonthName, formatDateBS } from '../../lib/format'
import { EmptyState, Skeleton } from '../../components/ui'
import { IconCalendar, IconChevronLeft, IconChevronRight } from '../../components/icons'

const TYPE_LABEL: Record<string, string> = {
  holiday: 'Public holiday',
  exam: 'Exam',
  result: 'Result',
  event: 'Event',
  vacation: 'Vacation',
}

const TYPE_DOT: Record<string, string> = {
  holiday: 'bg-danger',
  exam: 'bg-warning',
  result: 'bg-positive',
  event: 'bg-accent',
  vacation: 'bg-ink-faint',
}

export default function PortalCalendarPage() {
  const [month, setMonth] = useState('')
  const calendar = usePortalCalendar(month)

  const data = calendar.data
  const monthBs = data?.month_bs ?? month
  const [y, m] = monthBs ? monthBs.split('-').map(Number) : [0, 0]

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold tracking-tight">School calendar</h2>

      <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-2 py-1.5">
        <button
          aria-label="Previous month"
          onClick={() => monthBs && setMonth(shiftMonthBs(monthBs, -1))}
          className="flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
        >
          <IconChevronLeft size={18} />
        </button>
        <p className="text-sm font-semibold">{m ? `${bsMonthName(m)} ${y}` : '…'}</p>
        <button
          aria-label="Next month"
          onClick={() => monthBs && setMonth(shiftMonthBs(monthBs, 1))}
          className="flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
        >
          <IconChevronRight size={18} />
        </button>
      </div>

      {calendar.isLoading ? (
        <Skeleton className="h-48" />
      ) : !data || data.events.length === 0 ? (
        <EmptyState
          icon={<IconCalendar size={22} />}
          title="Nothing scheduled"
          hint="Holidays, exams and events for this month will appear here."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {data.events.map((event) => (
            <li key={event.id} className="flex items-start gap-3 px-4 py-3">
              <span
                aria-hidden
                className={`mt-1.5 size-2.5 shrink-0 rounded-full ${TYPE_DOT[event.event_type] ?? 'bg-accent'}`}
                style={event.color ? { backgroundColor: event.color } : undefined}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {event.description || TYPE_LABEL[event.event_type] || event.event_type}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {formatDateBS(event.start_date_bs)}
                  {event.end_date_bs !== event.start_date_bs &&
                    ` – ${formatDateBS(event.end_date_bs)}`}
                </p>
              </div>
              <span className="text-xs text-ink-faint">
                {TYPE_LABEL[event.event_type] ?? event.event_type}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
