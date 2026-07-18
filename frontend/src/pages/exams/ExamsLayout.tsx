import { NavLink, Outlet, useLocation } from 'react-router-dom'

/** Examinations workspace frame: exams, sheets & marks, schedule, grading. */

const TABS = [
  { to: '/exams/list', label: 'Exams' },
  { to: '/exams/sheets', label: 'Result sheets' },
  { to: '/exams/schedule', label: 'Schedule' },
  { to: '/exams/results', label: 'Results & print' },
  { to: '/exams/final', label: 'Final results' },
  { to: '/exams/activities', label: 'Activities' },
  { to: '/exams/entry-cards', label: 'Entry cards' },
  { to: '/exams/seat-plan', label: 'Seat plan' },
  { to: '/exams/certificates', label: 'Certificates' },
  { to: '/exams/grading', label: 'Grading' },
]

export default function ExamsLayout() {
  const location = useLocation()
  // Marks entry lives under /exams/sheets/:id/marks — keep its tab lit.
  const activeOverride = location.pathname.startsWith('/exams/sheets/') ? '/exams/sheets' : null

  return (
    <div className="mx-auto max-w-6xl">
      <nav
        aria-label="Examination sections"
        className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <div className="flex w-max gap-1 rounded-xl bg-surface-sunken p-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `flex h-9 items-center whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors ${
                  isActive || activeOverride === tab.to
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-ink-muted hover:text-ink'
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
