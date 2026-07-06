import { useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import {
  IconBilling,
  IconDashboard,
  IconLogout,
  IconMenu,
  IconStudents,
} from '../components/icons'

/**
 * Application frame, responsive by construction:
 *  - < lg: sidebar is an overlay drawer opened from the top bar; every
 *    tap target is at least 44px.
 *  - >= lg: sidebar is fixed and always visible; the drawer controls vanish.
 * Navigation is permission-aware: an item renders only when the account
 * holds one of its permission codes (admins hold all). Enforcement remains
 * server-side — hiding is UX, not security.
 */

type NavItem = {
  label: string
  to: string
  icon: ComponentType<{ size?: number }>
  needs?: string[]
}
type NavSection = { title: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', to: '/dashboard', icon: IconDashboard }],
  },
  {
    title: 'People',
    items: [
      {
        label: 'Students',
        to: '/students',
        icon: IconStudents,
        needs: ['students.view', 'students.manage'],
      },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        label: 'Billing',
        to: '/billing',
        icon: IconBilling,
        needs: ['billing.view', 'billing.manage'],
      },
    ],
  },
  // Modules land here as they are built: Academics, Examinations,
  // Attendance, Payroll, Accounting, Library, Transport, Communication.
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { account } = useAuth()
  const granted = new Set(account?.permissions ?? [])
  const visible = (item: NavItem) =>
    !item.needs || item.needs.some((code) => granted.has(code))

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-3 border-b border-border px-5">
        <div className="flex size-9 items-center justify-center rounded-lg bg-accent font-bold text-white">
          S
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight">School ERP</p>
          <p className="text-xs text-ink-muted">Platform console</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter(visible)
          if (items.length === 0) return null
          return (
            <div key={section.title} className="mb-6">
              <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
                {section.title}
              </p>
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-accent-soft text-accent-strong'
                        : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                    }`
                  }
                >
                  <item.icon size={18} aria-hidden />
                  {item.label}
                </NavLink>
              ))}
            </div>
          )
        })}
      </nav>
    </div>
  )
}

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { account, logout } = useAuth()
  // Longest matching prefix so nested module routes keep their title.
  const title =
    NAV_SECTIONS.flatMap((s) => s.items)
      .filter((i) => location.pathname === i.to || location.pathname.startsWith(`${i.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0]?.label ?? ''

  async function onLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-xl">
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 sm:px-6">
          <button
            aria-label="Open navigation"
            className="flex size-11 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken lg:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <IconMenu size={20} />
          </button>
          <h1 className="truncate text-base font-semibold sm:text-lg">{title}</h1>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-ink-muted sm:block">
              {account?.username} · {account?.role.replace('_', ' ')}
            </span>
            <button
              onClick={onLogout}
              className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken"
            >
              <IconLogout size={16} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
