import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth, type Role } from '../lib/auth'
import { IconBilling, IconCalendar, IconShield, IconStudents } from '../components/icons'

const ROLES: { value: Role; label: string; wide?: boolean }[] = [
  { value: 'guardian', label: 'Parent / Guardian', wide: true },
  { value: 'admin', label: 'School Admin' },
  { value: 'staff', label: 'Staff' },
  { value: 'student', label: 'Student' },
  { value: 'super_admin', label: 'Super Admin' },
]

const PROMISES = [
  {
    icon: IconStudents,
    title: 'One record of truth',
    text: 'Students, guardians, staff and classes — linked, never duplicated.',
  },
  {
    icon: IconBilling,
    title: 'Money that reconciles',
    text: 'Fees, receipts, payroll and double-entry books that always agree.',
  },
  {
    icon: IconCalendar,
    title: 'Today, at a glance',
    text: 'Attendance, dues and results the moment they happen — for the office and for families.',
  },
]

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [role, setRole] = useState<Role>('admin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(role, username.trim(), password)
      // Family principals land in the portal; a staff `from` would bounce.
      const family = role === 'guardian' || role === 'student'
      const from = (location.state as { from?: string } | null)?.from
      navigate(family ? '/portal' : (from ?? '/dashboard'), { replace: true })
    } catch {
      setError('Invalid credentials for the selected role.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full">
      {/* Brand panel — desktop only; the form is the whole story on phones. */}
      <aside className="relative hidden w-[44%] flex-col justify-between overflow-hidden bg-accent-deep p-10 text-white lg:flex xl:p-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(52rem 30rem at -10% -20%, rgba(56,189,248,.45), transparent 60%),' +
              'radial-gradient(40rem 26rem at 120% 115%, rgba(2,132,199,.55), transparent 60%)',
          }}
        />
        <div className="relative flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-white/15 text-lg font-bold backdrop-blur">
            S
          </div>
          <span className="text-lg font-semibold tracking-tight">School ERP</span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">
            Everything your school runs on, in one place.
          </h1>
          <ul className="mt-10 space-y-6">
            {PROMISES.map((promise) => (
              <li key={promise.title} className="flex gap-4">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/12">
                  <promise.icon size={18} aria-hidden />
                </span>
                <div>
                  <p className="font-medium">{promise.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-sky-100/80">
                    {promise.text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-sky-100/70">
          <IconShield size={14} aria-hidden />
          Per-school isolation, role-scoped access, audited actions.
        </p>
      </aside>

      {/* Form panel */}
      <div className="flex min-h-full flex-1 items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:text-left">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-accent text-xl font-bold text-white lg:hidden">
              S
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
            <p className="mt-1 text-sm text-ink-muted">Sign in to your workspace</p>
          </div>

          <form
            onSubmit={onSubmit}
            className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8"
          >
            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-medium">Sign in as</span>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    className={`min-h-11 rounded-lg border px-3 text-sm font-medium transition-colors ${
                      r.wide ? 'col-span-2' : ''
                    } ${
                      role === r.value
                        ? 'border-accent bg-accent-soft text-accent-strong'
                        : 'border-border text-ink-muted hover:bg-surface-sunken'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </label>

            <label className="mb-4 block">
              <span className="mb-1.5 block text-sm font-medium">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                minLength={4}
                className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
              />
            </label>

            <label className="mb-6 block">
              <span className="mb-1.5 block text-sm font-medium">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
              />
            </label>

            {error && (
              <p role="alert" className="mb-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="h-11 w-full rounded-lg bg-accent-strong text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-deep disabled:opacity-60"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-ink-faint">
            Parents and students: your school office issues your login.
          </p>
        </div>
      </div>
    </div>
  )
}
