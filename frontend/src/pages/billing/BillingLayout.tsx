import { NavLink, Outlet } from 'react-router-dom'

/**
 * Billing workspace frame: one place for the whole fee-to-receipt loop.
 * Sub-navigation is routed (deep links work) and horizontally scrollable on
 * phones so no tab is ever unreachable.
 */

const TABS = [
  { to: '/billing/collect', label: 'Collect' },
  { to: '/billing/receipts', label: 'Receipts' },
  { to: '/billing/fees', label: 'Fee plan' },
  { to: '/billing/batches', label: 'Billing runs' },
  { to: '/billing/discounts', label: 'Discounts' },
]

export default function BillingLayout() {
  return (
    <div className="mx-auto max-w-6xl">
      <nav
        aria-label="Billing sections"
        className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <div className="flex w-max gap-1 rounded-xl bg-surface-sunken p-1">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                `flex h-9 items-center whitespace-nowrap rounded-lg px-3.5 text-sm font-medium transition-colors ${
                  isActive
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
