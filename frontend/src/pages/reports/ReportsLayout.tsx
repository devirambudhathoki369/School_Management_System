import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../lib/auth'

/**
 * Reports workspace — the legacy "Reports" menu, rebuilt. Tabs are gated by
 * the OWNING module's permission (mirroring the server), so a billing clerk
 * sees finance sheets while a front-desk account sees only enrollment ones.
 */

type Tab = { to: string; label: string; needs?: string[]; adminOnly?: boolean }

const TABS: Tab[] = [
  { to: '/reports/transactions', label: 'Transactions', needs: ['billing'] },
  { to: '/reports/postings', label: 'Billing runs', needs: ['billing'] },
  { to: '/reports/dues', label: 'Remaining dues', needs: ['billing'] },
  { to: '/reports/ledgers', label: 'Student ledgers', needs: ['billing'] },
  { to: '/reports/income-plan', label: 'Income plan', needs: ['billing'] },
  { to: '/reports/discounts', label: 'Discounts', needs: ['billing'] },
  { to: '/reports/opening-balances', label: 'Opening balances', needs: ['billing'] },
  { to: '/reports/admissions', label: 'Admissions', needs: ['students'] },
  { to: '/reports/staff', label: 'Staff details', needs: ['staff'] },
  { to: '/reports/transport', label: 'Transport', needs: ['transport'] },
  { to: '/reports/homework', label: 'Homework', needs: ['homework'] },
  { to: '/reports/attendance', label: 'Attendance', needs: ['attendance'] },
  { to: '/reports/demographics', label: 'Demographics', needs: ['students'] },
  { to: '/reports/integrity', label: 'Integrity', adminOnly: true },
]

export function useVisibleReportTabs(): Tab[] {
  const { account } = useAuth()
  const isAdmin = account?.role === 'admin'
  const granted = new Set(account?.permissions ?? [])
  return TABS.filter((tab) => {
    if (tab.adminOnly) return isAdmin
    if (!tab.needs) return true
    return (
      isAdmin ||
      tab.needs.some((code) => granted.has(`${code}.view`) || granted.has(`${code}.manage`))
    )
  })
}

/** Index route: land on the first tab this account can actually open. */
export function ReportsIndex() {
  const tabs = useVisibleReportTabs()
  return <Navigate to={tabs[0]?.to ?? '/dashboard'} replace />
}

export default function ReportsLayout() {
  const tabs = useVisibleReportTabs()
  return (
    <div className="mx-auto max-w-6xl">
      <nav
        aria-label="Report sections"
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
