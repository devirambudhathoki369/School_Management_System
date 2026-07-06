import { NavLink, Outlet } from 'react-router-dom'

/** Attendance workspace frame: mark a class, review the day, staff register. */

const TABS = [
  { to: '/attendance/mark', label: 'Mark class' },
  { to: '/attendance/day', label: 'Day overview' },
  { to: '/attendance/staff', label: 'Staff' },
]

export default function AttendanceLayout() {
  return (
    <div className="mx-auto max-w-5xl">
      <nav
        aria-label="Attendance sections"
        className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
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
      <Outlet />
    </div>
  )
}
