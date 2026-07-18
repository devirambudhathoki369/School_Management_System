import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'

/**
 * People workspace frame. Staff records are admin-managed on the backend
 * (role gate, not just a module grant), so the Staff tab only renders for
 * admins — hiding is UX, enforcement stays server-side.
 */

export default function PeopleLayout() {
  const { account } = useAuth()
  const tabs = [
    { to: '/people/students', label: 'Students' },
    { to: '/people/bulk', label: 'Bulk tools' },
    ...(account?.role === 'admin' ? [{ to: '/people/staff', label: 'Staff' }] : []),
  ]

  return (
    <div className="mx-auto max-w-6xl">
      <nav
        aria-label="People sections"
        className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <div className="flex w-max gap-1 rounded-xl bg-surface-sunken p-1">
          {tabs.map((tab) => (
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
