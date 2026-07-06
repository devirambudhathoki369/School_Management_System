import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCalendar, useClasses, useYearPointers } from '../../lib/billing'
import { useDaySessions } from '../../lib/attendance'
import { formatDateBS } from '../../lib/format'
import { Badge, EmptyState, Input, SkeletonRows, StatCard } from '../../components/ui'
import { IconArrowRight, IconCalendar } from '../../components/icons'

/**
 * The day at a glance: which classes are marked, who is missing. Legacy had
 * no such view — absences only surfaced per class; here the whole school's
 * day is one screen.
 */

export default function DayOverviewPage() {
  const calendar = useCalendar()
  const [dateBs, setDateBs] = useState('')
  const date = dateBs || calendar.data?.today_bs || ''
  const sessions = useDaySessions(date || null)
  const pointers = useYearPointers()
  const runningYears = useMemo(
    () => [...new Set((pointers.data ?? []).map((p) => p.academic_year))],
    [pointers.data],
  )
  const classes = useClasses(runningYears)
  const classLabel = (id: string) => classes.data?.find((c) => c.id === id)?.label ?? '…'

  const rows = sessions.data ?? []
  const totals = rows.reduce(
    (acc, s) => {
      const present = s.records.filter((r) => r.present).length
      return {
        marked: acc.marked + s.records.length,
        present: acc.present + present,
      }
    },
    { marked: 0, present: 0 },
  )

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <Input
          value={date}
          onChange={(e) => setDateBs(e.target.value)}
          aria-label="Date (BS)"
          className="w-44"
        />
        <p className="text-sm text-ink-muted">{formatDateBS(date)}</p>
      </div>

      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <StatCard label="Classes marked" value={rows.length} />
          <StatCard label="Students present" value={totals.present.toLocaleString('en-IN')} />
          <StatCard
            label="Absent"
            value={(totals.marked - totals.present).toLocaleString('en-IN')}
          />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {sessions.isLoading ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconCalendar size={22} />}
            title="No classes marked on this day"
            hint="Registers appear here as teachers mark them."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((session) => {
              const present = session.records.filter((r) => r.present).length
              const absent = session.records.length - present
              const absentees = session.records.filter((r) => !r.present)
              return (
                <li key={session.id} className="px-4 py-3 sm:px-5">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {classLabel(session.class_info)}
                      </p>
                      <p className="text-xs text-ink-muted">
                        {present} present{absent > 0 && <> · {absent} absent</>}
                      </p>
                    </div>
                    {absent === 0 ? (
                      <Badge tone="positive">full house</Badge>
                    ) : (
                      <Badge tone="danger">{absent} away</Badge>
                    )}
                    <Link
                      to="/attendance/mark"
                      className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                      aria-label="Open register"
                    >
                      <IconArrowRight size={16} />
                    </Link>
                  </div>
                  {absentees.length > 0 && (
                    <p className="mt-1.5 truncate text-xs text-ink-faint">
                      Away:{' '}
                      {absentees
                        .slice(0, 6)
                        .map((r) => r.student_name + (r.reason ? ` (${r.reason})` : ''))
                        .join(', ')}
                      {absentees.length > 6 && ` +${absentees.length - 6} more`}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
