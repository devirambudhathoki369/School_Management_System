import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { useAuth, type SessionPayload } from '../lib/auth'
import { Button, Field, Input, Modal, apiErrorMessage, useToast } from './ui'
import { IconKey, IconLogout } from './icons'

/**
 * Self-service password change against /api/v1/auth/change-password/.
 * The endpoint blacklists every other session and returns a fresh token
 * pair, which we adopt so the current session survives the change.
 */

function ChangePasswordForm({
  onDone,
  submitLabel = 'Change password',
}: {
  onDone: () => void
  submitLabel?: string
}) {
  const { applySession } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const mismatch = confirm.length > 0 && next !== confirm

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (next !== confirm) return
    setError('')
    setBusy(true)
    try {
      const { data } = await api.post<SessionPayload>('/api/v1/auth/change-password/', {
        current_password: current,
        new_password: next,
      })
      applySession(data)
      toast.success('Password changed. Other devices have been signed out.')
      onDone()
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Current password">
        <Input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
          autoFocus
        />
      </Field>
      <Field label="New password" hint="At least 10 characters; not a common or all-numeric password.">
        <Input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          required
          minLength={10}
        />
      </Field>
      <Field label="Confirm new password" error={mismatch ? 'Passwords do not match.' : undefined}>
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
      </Field>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" busy={busy} disabled={!current || !next || next !== confirm} className="w-full">
        {submitLabel}
      </Button>
    </form>
  )
}

/** Voluntary change, launched from the app header. */
export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Change password">
      <ChangePasswordForm onDone={onClose} />
    </Modal>
  )
}

/**
 * Blocking screen shown instead of the app while the account carries
 * password_change_required — temp credentials never reach the workspace.
 */
export function ForcedPasswordChange() {
  const { account, logout } = useAuth()
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-accent text-white">
            <IconKey size={22} />
          </div>
          <h1 className="text-xl font-semibold">Set your own password</h1>
          <p className="mt-1 text-sm text-ink-muted">
            You signed in as <span className="font-medium text-ink">{account?.username}</span> with
            a temporary password. Choose a new one to continue.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <ChangePasswordForm onDone={() => undefined} submitLabel="Save and continue" />
        </div>
        <button
          onClick={() => void logout()}
          className="mx-auto mt-6 flex min-h-10 items-center gap-2 text-sm font-medium text-ink-muted hover:text-ink"
        >
          <IconLogout size={16} /> Sign out instead
        </button>
      </div>
    </div>
  )
}
