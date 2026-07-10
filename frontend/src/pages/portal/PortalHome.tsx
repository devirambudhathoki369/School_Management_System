import { Link } from 'react-router-dom'
import { useChildren, useNotices, type PortalChild } from '../../lib/portal'
import { formatDateBS, formatMoneyRs } from '../../lib/format'
import { Badge, EmptyState, Skeleton } from '../../components/ui'
import { IconChevronRight, IconMegaphone, IconStudents } from '../../components/icons'

/** Landing view: every child at a glance — today first, then the money. */
export default function PortalHome() {
  const home = useChildren()
  const notices = useNotices()

  if (home.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    )
  }
  if (home.isError || !home.data) {
    return (
      <EmptyState
        icon={<IconStudents size={22} />}
        title="Could not load your family"
        hint="Pull to refresh or sign in again — if it persists, contact the school office."
      />
    )
  }
  const { guardian, today_bs, children } = home.data
  const latest = (notices.data?.notices ?? []).slice(0, 3)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">
          Namaste, {guardian.name.split(' ')[0]}
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">{formatDateBS(today_bs)}</p>
      </div>

      {children.length === 0 ? (
        <EmptyState
          icon={<IconStudents size={22} />}
          title="No students linked yet"
          hint="Ask the school office to link your children to this account."
        />
      ) : (
        <div className="space-y-3">
          {children.map((child) => (
            <ChildCard key={child.id} child={child} />
          ))}
        </div>
      )}

      <section aria-label="Latest notices">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-faint">
            Latest notices
          </h3>
          <Link
            to="/portal/notices"
            className="text-sm font-medium text-accent-strong hover:underline"
          >
            See all
          </Link>
        </div>
        {latest.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-5 text-sm text-ink-muted">
            Nothing from the school yet.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {latest.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                  <IconMegaphone size={15} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{n.title}</p>
                  <p className="text-xs text-ink-muted">{formatDateBS(n.date_bs)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ChildCard({ child }: { child: PortalChild }) {
  const dues = Number(child.dues)
  const attendance = child.attendance_today
  return (
    <Link
      to={`/portal/children/${child.id}`}
      className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
    >
      <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg font-semibold text-accent-strong">
        {child.first_name[0]}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold">{child.full_name}</p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {child.class_label}
          {child.roll_no ? ` · Roll ${child.roll_no}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {attendance === null ? (
            <Badge tone="neutral">Not marked today</Badge>
          ) : attendance.present ? (
            <Badge tone="positive">Present today</Badge>
          ) : (
            <Badge tone="danger">Absent today</Badge>
          )}
          {dues > 0 ? (
            <Badge tone="warning">Due {formatMoneyRs(child.dues)}</Badge>
          ) : (
            <Badge tone="positive">Fees clear</Badge>
          )}
        </div>
      </div>
      <IconChevronRight size={18} className="shrink-0 text-ink-faint" />
    </Link>
  )
}
