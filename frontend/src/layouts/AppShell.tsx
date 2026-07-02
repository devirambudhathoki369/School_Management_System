import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

/**
 * Application frame, responsive by construction:
 *  - < lg: sidebar is an overlay drawer opened from the top bar; every
 *    tap target is at least 44px.
 *  - >= lg: sidebar is fixed and always visible; the drawer controls vanish.
 * New modules appear in navigation by adding one entry to NAV_SECTIONS.
 */

type NavItem = { label: string; to: string; icon: string }
type NavSection = { title: string; items: NavItem[] }

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', to: '/dashboard', icon: '▦' }],
  },
  // Modules land here as they are built: Academics, People, Examinations,
  // Attendance, Billing, Accounting, Library, Transport, Communication.
]

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
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
        {NAV_SECTIONS.map((section) => (
          <div key={section.title} className="mb-6">
            <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
              {section.title}
            </p>
            {section.items.map((item) => (
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
                <span aria-hidden>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </div>
  )
}

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const title =
    NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.to === location.pathname)?.label ?? ''

  return (
    <div className="flex h-full">
      {/* Fixed sidebar (desktop) */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent />
      </aside>

      {/* Drawer (mobile / tablet) */}
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
            ☰
          </button>
          <h1 className="truncate text-base font-semibold sm:text-lg">{title}</h1>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
