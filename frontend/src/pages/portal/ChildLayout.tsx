import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useChildren, type PortalChild } from '../../lib/portal'
import { Badge, EmptyState, Skeleton } from '../../components/ui'
import { IconChevronLeft, IconStudents } from '../../components/icons'

const TABS = [
  { to: 'attendance', label: 'Attendance' },
  { to: 'results', label: 'Results' },
  { to: 'fees', label: 'Fees' },
  { to: 'homework', label: 'Homework' },
]

/** One child's hub: identity header + routed tabs. Children come from the
 * cached family payload — the portal never fetches a student directly. */
export default function ChildLayout() {
  const { childId } = useParams()
  const home = useChildren()

  if (home.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-48" />
      </div>
    )
  }
  const child = home.data?.children.find((c) => c.id === childId)
  if (!child) {
    return (
      <EmptyState
        icon={<IconStudents size={22} />}
        title="Student not found"
        hint="This link may be stale — go back to your family overview."
        action={
          <Link to="/portal" className="text-sm font-medium text-accent-strong hover:underline">
            Back to home
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <Link
        to="/portal"
        className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink"
      >
        <IconChevronLeft size={16} /> Home
      </Link>

      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg font-semibold text-accent-strong">
          {child.first_name[0]}
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{child.full_name}</p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {child.class_label} · {child.academic_year_name}
            {child.roll_no ? ` · Roll ${child.roll_no}` : ''}
          </p>
        </div>
        {child.status !== 'running' && (
          <span className="ml-auto">
            <Badge tone="warning">{child.status.replace(/_/g, ' ')}</Badge>
          </span>
        )}
      </div>

      <nav aria-label="Child sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-1 rounded-xl bg-surface-sunken p-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `flex h-9 items-center whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
                }`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

      <Outlet context={child satisfies PortalChild} />
    </div>
  )
}
