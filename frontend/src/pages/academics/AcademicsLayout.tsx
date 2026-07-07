import { NavLink, Outlet } from 'react-router-dom'

/** Academics workspace frame: classes, subjects, structure vocabulary, years. */

const TABS = [
  { to: '/academics/classes', label: 'Classes' },
  { to: '/academics/subjects', label: 'Subjects' },
  { to: '/academics/structure', label: 'Courses & sections' },
  { to: '/academics/years', label: 'Years' },
]

export default function AcademicsLayout() {
  return (
    <div className="mx-auto max-w-5xl">
      <nav
        aria-label="Academics sections"
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
