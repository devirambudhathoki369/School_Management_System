import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth, type Role } from '../lib/auth'

const ROLES: { value: Role; label: string; wide?: boolean }[] = [
  { value: 'guardian', label: 'Parent / Guardian', wide: true },
  { value: 'admin', label: 'School Admin' },
  { value: 'staff', label: 'Staff' },
  { value: 'student', label: 'Student' },
  { value: 'super_admin', label: 'Super Admin' },
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
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-accent text-xl font-bold text-white">
            S
          </div>
          <h1 className="text-xl font-semibold">School ERP</h1>
          <p className="text-sm text-ink-muted">Sign in to your workspace</p>
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
            <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="h-11 w-full rounded-lg bg-accent text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:opacity-60"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
