import { useMemo, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useCalendar } from '../lib/billing'
import { formatDateBS } from '../lib/format'
import { ChangePasswordModal } from '../components/ChangePassword'
import {
  IconBilling,
  IconBook,
  IconBus,
  IconCalendar,
  IconChevronDown,
  IconClipboard,
  IconDashboard,
  IconKey,
  IconLayers,
  IconLibrary,
  IconLogout,
  IconMegaphone,
  IconMenu,
  IconNotebook,
  IconPackage,
  IconScan,
  IconShield,
  IconStudents,
  IconWallet,
} from '../components/icons'

/**
 * Application frame. The sidebar is a two-level menu — every workspace tab
 * is reachable in one click, the way the legacy console exposed its whole
 * surface — grouped under the module it belongs to. Groups auto-expand for
 * the active route; visibility follows the account's module permissions
 * (admins hold all). Enforcement stays server-side — hiding is UX.
 *
 * Responsive by construction: < lg the sidebar is an overlay drawer with
 * 44px+ targets; >= lg it is fixed. The content header carries the page
 * title and today's BS date.
 */

type Leaf = { label: string; to: string; adminOnly?: boolean }
type Group = {
  label: string
  icon: ComponentType<{ size?: number }>
  needs?: string[]
  adminOnly?: boolean
  /** Single-page module: link directly, no submenu. */
  to?: string
  children?: Leaf[]
}
type Section = { title: string; groups: Group[] }

const NAV: Section[] = [
  {
    title: 'Overview',
    groups: [{ label: 'Dashboard', icon: IconDashboard, to: '/dashboard' }],
  },
  {
    title: 'People',
    groups: [
      {
        label: 'Enrollment',
        icon: IconStudents,
        needs: ['students.view', 'students.manage'],
        children: [
          { label: 'Students', to: '/people/students' },
          { label: 'Staff', to: '/people/staff' },
        ],
      },
    ],
  },
  {
    title: 'Academics',
    groups: [
      {
        label: 'Academics',
        icon: IconBook,
        needs: ['academics.view', 'academics.manage'],
        children: [
          { label: 'Classes & periods', to: '/academics/classes' },
          { label: 'Courses & subjects', to: '/academics/subjects' },
          { label: 'Structure', to: '/academics/structure' },
          { label: 'Academic years', to: '/academics/years' },
        ],
      },
      {
        label: 'Attendance',
        icon: IconCalendar,
        needs: ['attendance.view', 'attendance.manage'],
        children: [
          { label: 'Mark class', to: '/attendance/mark' },
          { label: 'Day overview', to: '/attendance/day' },
          { label: 'Staff register', to: '/attendance/staff' },
        ],
      },
      {
        label: 'Exams & results',
        icon: IconClipboard,
        needs: ['examinations.view', 'examinations.manage'],
        children: [
          { label: 'Exams & publishing', to: '/exams/list' },
          { label: 'Result sheets & marks', to: '/exams/sheets' },
          { label: 'Exam schedule', to: '/exams/schedule' },
          { label: 'Grading rules', to: '/exams/grading' },
        ],
      },
      {
        label: 'Homework',
        icon: IconNotebook,
        needs: ['homework.view', 'homework.manage'],
        to: '/homework',
      },
    ],
  },
  {
    title: 'Finance',
    groups: [
      {
        label: 'Billing',
        icon: IconBilling,
        needs: ['billing.view', 'billing.manage'],
        children: [
          { label: 'Collect payment', to: '/billing/collect' },
          { label: 'Receipts', to: '/billing/receipts' },
          { label: 'Fee plan', to: '/billing/fees' },
          { label: 'Billing runs', to: '/billing/batches' },
          { label: 'Discounts', to: '/billing/discounts' },
        ],
      },
      {
        label: 'Accounting',
        icon: IconLayers,
        needs: ['accounting.view', 'accounting.manage'],
        children: [
          { label: 'Vouchers', to: '/accounting/vouchers' },
          { label: 'New voucher', to: '/accounting/new' },
          { label: 'Trial balance', to: '/accounting/trial-balance' },
          { label: 'Profit & loss', to: '/accounting/profit-loss' },
          { label: 'Balance sheet', to: '/accounting/balance-sheet' },
          { label: 'Ledger statement', to: '/accounting/statement' },
          { label: 'Ledgers', to: '/accounting/ledgers' },
          { label: 'Fiscal years', to: '/accounting/fiscal-years' },
        ],
      },
      {
        label: 'Payroll',
        icon: IconWallet,
        needs: ['payroll.view', 'payroll.manage'],
        children: [
          { label: 'Pay salary', to: '/payroll/pay' },
          { label: 'Run payroll', to: '/payroll/run' },
          { label: 'Payments', to: '/payroll/payments' },
          { label: 'Postings', to: '/payroll/postings' },
          { label: 'Staff ledger', to: '/payroll/ledger' },
          { label: 'Salary structures', to: '/payroll/structures' },
        ],
      },
    ],
  },
  {
    title: 'Campus',
    groups: [
      {
        label: 'Library',
        icon: IconLibrary,
        needs: ['library.view', 'library.manage'],
        children: [
          { label: 'Books & copies', to: '/library/books' },
          { label: 'Issue / return', to: '/library/circulation' },
          { label: 'Library setup', to: '/library/settings' },
        ],
      },
      {
        label: 'Transport',
        icon: IconBus,
        needs: ['transport.view', 'transport.manage'],
        children: [
          { label: 'Bus stations', to: '/transport/stations' },
          { label: 'Riders', to: '/transport/riders' },
        ],
      },
      {
        label: 'Communication',
        icon: IconMegaphone,
        needs: ['communication.view', 'communication.manage'],
        children: [
          { label: 'Notices', to: '/communication/notices' },
          { label: 'Academic calendar', to: '/communication/calendar' },
          { label: 'Message templates', to: '/communication/templates' },
          { label: 'Deliveries', to: '/communication/deliveries' },
        ],
      },
      {
        label: 'Inventory',
        icon: IconPackage,
        needs: ['inventory.view', 'inventory.manage'],
        children: [
          { label: 'Stock', to: '/inventory/stock' },
          { label: 'Movements', to: '/inventory/movements' },
        ],
      },
      {
        label: 'RFID devices',
        icon: IconScan,
        needs: ['devices.view', 'devices.manage'],
        children: [
          { label: 'Device registry', to: '/devices/registry' },
          { label: 'Device users', to: '/devices/users' },
          { label: 'Punch log', to: '/devices/punches' },
        ],
      },
    ],
  },
  {
    title: 'Oversight',
    groups: [
      {
        label: 'Audit log',
        icon: IconShield,
        adminOnly: true,
        to: '/audit',
      },
    ],
  },
]

function useVisibleNav(): Section[] {
  const { account } = useAuth()
  return useMemo(() => {
    const isAdmin = account?.role === 'admin'
    const granted = new Set(account?.permissions ?? [])
    const groupVisible = (group: Group) => {
      if (group.adminOnly) return isAdmin
      if (!group.needs) return true
      return isAdmin || group.needs.some((code) => granted.has(code))
    }
    return NAV.map((section) => ({
      ...section,
      groups: section.groups.filter(groupVisible),
    })).filter((section) => section.groups.length > 0)
  }, [account])
}

/** Group containing the current route — it renders expanded. Matching is by
 * module root (first path segment) so detail pages keep their group open. */
function activeGroupOf(pathname: string): string | null {
  const root = `/${pathname.split('/')[1] ?? ''}`
  for (const section of NAV) {
    for (const group of section.groups) {
      if (group.to === root) return group.label
      if (group.children?.some((leaf) => leaf.to.startsWith(`${root}/`)))
        return group.label
    }
  }
  return null
}

function pageTitle(pathname: string): string {
  for (const section of NAV) {
    for (const group of section.groups) {
      if (group.to && (pathname === group.to || pathname.startsWith(`${group.to}/`)))
        return group.label
      const leaf = group.children?.find(
        (l) => pathname === l.to || pathname.startsWith(`${l.to}/`),
      )
      if (leaf) return `${group.label} · ${leaf.label}`
      // module root (e.g. /people/students/:id) — fall back to the group
      const moduleRoot = group.children?.[0]?.to.split('/')[1]
      if (moduleRoot && pathname.startsWith(`/${moduleRoot}/`)) return group.label
    }
  }
  return ''
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { account, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const sections = useVisibleNav()
  const active = activeGroupOf(location.pathname)
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [changingPassword, setChangingPassword] = useState(false)

  const isOpen = (group: Group) => opened.has(group.label) || active === group.label
  const toggle = (label: string) =>
    setOpened((s) => {
      const next = new Set(s)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })

  async function onLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  const leafClass = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-9 items-center rounded-md py-1.5 pl-3 pr-2 text-[13px] transition-colors ${
      isActive
        ? 'bg-accent-soft font-medium text-accent-strong'
        : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
    }`

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent font-bold text-white">
          {account?.school?.name?.[0] ?? 'S'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {account?.school?.name ?? 'School ERP'}
          </p>
          <p className="text-xs text-ink-muted">Platform console</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {sections.map((section) => (
          <div key={section.title} className="mb-4">
            <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {section.title}
            </p>
            {section.groups.map((group) => {
              if (group.to) {
                return (
                  <NavLink
                    key={group.label}
                    to={group.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-accent-soft text-accent-strong'
                          : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                      }`
                    }
                  >
                    <group.icon size={17} aria-hidden />
                    {group.label}
                  </NavLink>
                )
              }
              const open = isOpen(group)
              const current = active === group.label
              return (
                <div key={group.label}>
                  <button
                    onClick={() => toggle(group.label)}
                    aria-expanded={open}
                    className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${
                      current
                        ? 'text-ink'
                        : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                    }`}
                  >
                    <group.icon size={17} aria-hidden />
                    <span className="flex-1 text-left">{group.label}</span>
                    <IconChevronDown
                      size={14}
                      aria-hidden
                      className={`text-ink-faint transition-transform ${open ? '' : '-rotate-90'}`}
                    />
                  </button>
                  {open && (
                    <div className="mb-1 ml-[21px] space-y-0.5 border-l border-border pl-2.5">
                      {group.children!.map((leaf) => (
                        <NavLink
                          key={leaf.to}
                          to={leaf.to}
                          onClick={onNavigate}
                          className={leafClass}
                        >
                          {leaf.label}
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-sm font-semibold text-ink-muted">
            {account?.username?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{account?.username}</p>
            <p className="text-xs capitalize text-ink-muted">
              {account?.role.replace('_', ' ')}
            </p>
          </div>
          <button
            onClick={() => setChangingPassword(true)}
            aria-label="Change password"
            title="Change password"
            className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
          >
            <IconKey size={16} />
          </button>
          <button
            onClick={onLogout}
            aria-label="Sign out"
            title="Sign out"
            className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
          >
            <IconLogout size={16} />
          </button>
        </div>
      </div>

      {changingPassword && (
        <ChangePasswordModal onClose={() => setChangingPassword(false)} />
      )}
    </div>
  )
}

export default function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const location = useLocation()
  const calendar = useCalendar()
  const title = pageTitle(location.pathname)

  return (
    <div className="flex h-full">
      <aside className="hidden w-[17rem] shrink-0 border-r border-border bg-surface lg:block">
        <SidebarContent />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[19rem] max-w-[88vw] bg-surface shadow-xl">
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
          {calendar.data && (
            <span className="ml-auto hidden items-center gap-1.5 rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-ink-muted sm:inline-flex">
              <IconCalendar size={13} aria-hidden />
              {formatDateBS(calendar.data.today_bs)}
            </span>
          )}
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
