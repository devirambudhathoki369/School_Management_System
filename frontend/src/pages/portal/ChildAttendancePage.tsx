import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { useChildAttendance, shiftMonthBs, type PortalChild } from '../../lib/portal'
import { bsMonthName, formatDateBS } from '../../lib/format'
import { Badge, Skeleton } from '../../components/ui'
import { IconChevronLeft, IconChevronRight } from '../../components/icons'

function timeOnly(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** One BS month of the register, newest day first, with an honest summary —
 * only days the class was actually marked count. */
export default function ChildAttendancePage() {
  const { childId } = useParams()
  const child = useOutletContext<PortalChild>()
  const [month, setMonth] = useState('') // '' = current month (server default)
  const attendance = useChildAttendance(childId!, month)

  const data = attendance.data
  const monthBs = data?.month_bs ?? month
  const [y, m] = monthBs ? monthBs.split('-').map(Number) : [0, 0]
  const pct =
    data && data.summary.marked > 0
      ? Math.round((data.summary.present * 100) / data.summary.marked)
      : null

  return (
    <div className="space-y-4">
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

      {attendance.isLoading ? (
        <Skeleton className="h-48" />
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Marked days" value={String(data.summary.marked)} />
            <Stat label="Present" value={String(data.summary.present)} tone="text-positive" />
            <Stat label="Absent" value={String(data.summary.absent)} tone="text-danger" />
          </div>

          {pct !== null && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-sm font-medium">Attendance rate</p>
                <p className="text-sm font-semibold">{pct}%</p>
              </div>
              <div
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className="mt-2 h-2 overflow-hidden rounded-full bg-surface-sunken"
              >
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {data.days.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-ink-muted">
              No attendance was marked for {child.first_name} this month.
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {[...data.days].reverse().map((day) => (
                <li key={day.date_bs} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{formatDateBS(day.date_bs)}</p>
                    {(day.reason || day.checked_in_at) && (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {day.present
                          ? [
                              day.checked_in_at && `In ${timeOnly(day.checked_in_at)}`,
                              day.checked_out_at && `out ${timeOnly(day.checked_out_at)}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : day.reason}
                      </p>
                    )}
                  </div>
                  <Badge tone={day.present ? 'positive' : 'danger'}>
                    {day.present ? 'Present' : 'Absent'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-center">
      <p className={`text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </p>
    </div>
  )
}
