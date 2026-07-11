import { NavLink, Outlet } from 'react-router-dom'

/** Payroll workspace frame: accrue, pay, reconcile. */

const TABS = [
  { to: '/payroll/pay', label: 'Pay salary' },
  { to: '/payroll/run', label: 'Run payroll' },
  { to: '/payroll/payments', label: 'Payments' },
  { to: '/payroll/sheet', label: 'Salary sheet' },
  { to: '/payroll/postings', label: 'Postings' },
  { to: '/payroll/ledger', label: 'Staff ledger' },
  { to: '/payroll/structures', label: 'Structures' },
]

export default function PayrollLayout() {
  return (
    <div className="mx-auto max-w-6xl">
      <nav
        aria-label="Payroll sections"
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
