import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { formatMoney } from '../lib/format'
import { IconAlert, IconCheck, IconCopy, IconSpinner, IconX } from './icons'

/**
 * Shared UI primitives. Every module page composes these so the product
 * looks like one hand built it: consistent focus rings, 44px touch targets,
 * the same motion timing everywhere. Tokens come from index.css — no raw
 * palette values here.
 */

// ---------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent-strong text-white shadow-sm hover:bg-accent-deep active:bg-accent-deep',
  secondary:
    'border border-border bg-surface text-ink shadow-sm hover:bg-surface-muted active:bg-surface-sunken',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  danger: 'bg-danger text-white shadow-sm hover:opacity-90',
}

export function Button({
  variant = 'primary',
  busy = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      disabled={disabled || busy}
      className={`inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    >
      {busy && <IconSpinner size={16} />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- Fields

export function Field({
  label,
  error,
  hint,
  children,
  className = '',
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-faint">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-danger">{error}</span>}
    </label>
  )
}

const CONTROL =
  'h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-ink outline-none transition-shadow placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft disabled:bg-surface-sunken disabled:text-ink-muted'

export function Input({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} ${className}`} {...props} />
}

export function Select({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${CONTROL} appearance-none pr-8 ${className}`} {...props}>
      {children}
    </select>
  )
}

/** Right-aligned numeric input for money columns. */
export function AmountInput({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.01"
      min="0"
      className={`${CONTROL} text-right tabular-nums ${className}`}
      {...props}
    />
  )
}

// ---------------------------------------------------------------- Badge

type BadgeTone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger'

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted',
  accent: 'bg-accent-soft text-accent-strong',
  positive: 'bg-positive-soft text-positive',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------- Money

export function Money({
  value,
  className = '',
  signed = false,
}: {
  value: string | number | null | undefined
  className?: string
  signed?: boolean
}) {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  const negative = !Number.isNaN(n) && n < 0
  return (
    <span
      className={`tabular-nums ${negative && signed ? 'text-danger' : ''} ${className}`}
    >
      {formatMoney(negative ? Math.abs(n) : value)}
      {negative && signed ? ' Dr' : ''}
    </span>
  )
}

// ---------------------------------------------------------------- StatCard

export function StatCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-ink-muted">{label}</p>
        {icon && <span className="text-ink-faint">{icon}</span>}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-ink-faint">{detail}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- Modal

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        aria-label="Close dialog"
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* Bottom sheet on phones, centered card from sm up */}
      <div
        className={`relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl ${
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
        }`}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken"
          >
            <IconX size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------- Toasts

interface Toast {
  id: number
  tone: 'success' | 'error'
  message: string
}

const ToastContext = createContext<((tone: Toast['tone'], message: string) => void) | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, tone, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-lg ${
              t.tone === 'success'
                ? 'border-positive/25 bg-positive-soft text-positive'
                : 'border-danger/25 bg-danger-soft text-danger'
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {t.tone === 'success' ? <IconCheck size={16} /> : <IconAlert size={16} />}
            </span>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const push = useContext(ToastContext)
  if (!push) throw new Error('useToast must be used inside ToastProvider')
  return useMemo(
    () => ({
      success: (message: string) => push('success', message),
      error: (message: string) => push('error', message),
    }),
    [push],
  )
}

/** Flatten a DRF error payload into one readable sentence for a toast. */
export function apiErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: unknown } })?.response?.data
  if (typeof data === 'string') return data.slice(0, 200)
  if (data && typeof data === 'object') {
    const walk = (value: unknown): string[] => {
      if (typeof value === 'string') return [value]
      if (Array.isArray(value)) return value.flatMap(walk)
      if (value && typeof value === 'object')
        return Object.entries(value).flatMap(([k, v]) =>
          walk(v).map((m) => (k === 'message' || /^\d+$/.test(k) ? m : `${k}: ${m}`)),
        )
      return []
    }
    const messages = walk(data)
    if (messages.length) return messages.slice(0, 3).join(' · ')
  }
  return 'Something went wrong. Please try again.'
}

// ---------------------------------------------------------------- States

/** One credential line with a copy button — the hand-over ceremony for
 *  provisioned logins (temp passwords appear exactly once, so copying must
 *  be effortless). */
export function Credential({ label, value }: { label: string; value: string }) {
  const toast = useToast()
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</p>
        <p className="truncate font-mono text-base font-semibold tracking-wide">{value}</p>
      </div>
      <button
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          toast.success(`${label} copied.`)
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-surface hover:text-ink"
      >
        <IconCopy size={16} />
      </button>
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-sunken ${className}`} />
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-4">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-surface-sunken text-ink-faint">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-ink-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- Pagination

export function Pagination({
  count,
  page,
  pageSize,
  onPage,
  label,
}: {
  count: number
  page: number
  pageSize: number
  onPage: (page: number) => void
  label: string
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize))
  if (count <= pageSize) return null
  return (
    <div className="mt-4 flex items-center justify-between gap-3 text-sm">
      <p className="text-ink-muted">
        {count.toLocaleString('en-IN')} {label} · page {page} of {pages}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
