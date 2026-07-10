import { NavLink, Outlet } from 'react-router-dom'

/** Accounting workspace frame: voucher entry, the register, and reports. */

const TABS = [
  { to: '/accounting/vouchers', label: 'Vouchers' },
  { to: '/accounting/new', label: 'New voucher' },
  { to: '/accounting/trial-balance', label: 'Trial balance' },
  { to: '/accounting/profit-loss', label: 'P&L' },
  { to: '/accounting/balance-sheet', label: 'Balance sheet' },
  { to: '/accounting/cash-flow', label: 'Cash flow' },
  { to: '/accounting/statement', label: 'Ledger statement' },
  { to: '/accounting/ledgers', label: 'Ledgers' },
  { to: '/accounting/fiscal-years', label: 'Fiscal years' },
]

export default function AccountingLayout() {
  return (
    <div className="mx-auto max-w-6xl">
      <nav
        aria-label="Accounting sections"
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
