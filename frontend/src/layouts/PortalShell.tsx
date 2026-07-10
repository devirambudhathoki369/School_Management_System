import { useState, type ComponentType } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { ChangePasswordModal } from '../components/ChangePassword'
import {
  IconCalendar,
  IconHome,
  IconKey,
  IconLogout,
  IconMegaphone,
} from '../components/icons'

/**
 * Guardian portal frame — a phone-first surface, deliberately unlike the
 * staff console: no sidebar, no permission matrix. Bottom tab bar on
 * handsets (thumb reach), the same three tabs inline in the header on
 * wider screens. Content column stays narrow like a feed.
 */

const TABS: Array<{ to: string; label: string; icon: ComponentType<{ size?: number }> }> = [
  { to: '/portal', label: 'Home', icon: IconHome },
  { to: '/portal/notices', label: 'Notices', icon: IconMegaphone },
  { to: '/portal/calendar', label: 'Calendar', icon: IconCalendar },
]

function tabClass(isActive: boolean) {
  return `flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-accent-soft text-accent-strong' : 'text-ink-muted hover:text-ink'
  }`
}

export default function PortalShell() {
  const { account, logout } = useAuth()
  const navigate = useNavigate()
  const [changingPassword, setChangingPassword] = useState(false)

  async function onLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
            {account?.school?.name?.[0] ?? 'S'}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              {account?.school?.name}
            </p>
            <p className="text-[11px] leading-tight text-ink-muted">Parent portal</p>
          </div>
          <nav aria-label="Portal" className="ml-6 hidden items-center gap-1 sm:flex">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === '/portal'}
                className={({ isActive }) => tabClass(isActive)}
              >
                <tab.icon size={16} aria-hidden />
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setChangingPassword(true)}
              aria-label="Change password"
              title="Change password"
              className="flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
            >
              <IconKey size={17} />
            </button>
            <button
              onClick={onLogout}
              aria-label="Sign out"
              title="Sign out"
              className="flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
            >
              <IconLogout size={17} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-5 sm:pb-10">
        <Outlet />
      </main>

      <nav
        aria-label="Portal"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <div className="mx-auto flex max-w-3xl">
          {TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.to === '/portal'}
              className={({ isActive }) =>
                `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  isActive ? 'text-accent-strong' : 'text-ink-muted'
                }`
              }
            >
              <tab.icon size={20} aria-hidden />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {changingPassword && (
        <ChangePasswordModal onClose={() => setChangingPassword(false)} />
      )}
    </div>
  )
}
