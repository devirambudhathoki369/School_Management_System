import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import {
  useAcademicYearsFull,
  useClassesOfYear,
  useYearPointersFull,
  type AcademicYearFull,
  type YearPointerFull,
} from '../../lib/academics'
import { currentBillingYear, useBillingYears, useCalendar } from '../../lib/billing'
import { formatDateBS } from '../../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconArrowRight, IconCalendar, IconPencil, IconPlus } from '../../components/icons'

/**
 * Academic years and the year pointers that define "now" (invariant A2).
 * Year-end closing lives here: an admin closes a pointer's year (Y1/Y2 —
 * per-student balances become opening charges in the new year) and can undo
 * the last close (Y3) while the new year is still untouched.
 */
export default function YearsPage() {
  const { account } = useAuth()
  const isAdmin = account?.role === 'admin'
  const years = useAcademicYearsFull()
  const pointers = useYearPointersFull()
  const [editingYear, setEditingYear] = useState<AcademicYearFull | 'new' | null>(null)
  const [editingPointer, setEditingPointer] = useState<YearPointerFull | 'new' | null>(null)
  const [closing, setClosing] = useState<YearPointerFull | null>(null)
  const [undoing, setUndoing] = useState<YearPointerFull | null>(null)

  const yearName = (id: string | null) =>
    years.data?.find((y) => y.id === id)?.name ?? '—'

  const sortedYears = useMemo(
    () =>
      [...(years.data ?? [])].sort((a, b) =>
        b.start_date_bs.localeCompare(a.start_date_bs),
      ),
    [years.data],
  )

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">Running years</h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              Each pointer tracks the live year for one faculty group.
            </p>
          </div>
          {isAdmin && (
            <Button variant="secondary" onClick={() => setEditingPointer('new')}>
              <IconPlus size={16} /> New pointer
            </Button>
          )}
        </div>
        {pointers.isLoading ? (
          <SkeletonRows rows={2} />
        ) : (pointers.data ?? []).length === 0 ? (
          <EmptyState
            icon={<IconCalendar size={22} />}
            title="No year pointer yet"
            hint="Create one so the school has a defined running year."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(pointers.data ?? []).map((p) => (
              <li
                key={p.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Badge tone="accent">{p.key}</Badge>
                  <div className="flex min-w-0 items-center gap-2 text-sm">
                    {p.previous_academic_year && (
                      <>
                        <span className="truncate text-ink-faint">
                          {yearName(p.previous_academic_year)}
                        </span>
                        <IconArrowRight size={14} className="shrink-0 text-ink-faint" />
                      </>
                    )}
                    <span className="truncate font-semibold">
                      {yearName(p.academic_year)}
                    </span>
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      aria-label={`Edit pointer ${p.key}`}
                      onClick={() => setEditingPointer(p)}
                      className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                    >
                      <IconPencil size={16} />
                    </button>
                    {p.previous_academic_year && (
                      <Button variant="secondary" onClick={() => setUndoing(p)}>
                        Undo close
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => setClosing(p)}>
                      Close year…
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold">Academic years</h3>
          <Button variant="secondary" onClick={() => setEditingYear('new')}>
            <IconPlus size={16} /> New year
          </Button>
        </div>
        {years.isLoading ? (
          <SkeletonRows rows={5} />
        ) : sortedYears.length === 0 ? (
          <EmptyState icon={<IconCalendar size={22} />} title="No academic years yet" />
        ) : (
          <ul className="divide-y divide-border">
            {sortedYears.map((y) => (
              <li key={y.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{y.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {formatDateBS(y.start_date_bs)} — {formatDateBS(y.end_date_bs)}
                    {y.remarks ? ` · ${y.remarks}` : ''}
                  </p>
                </div>
                {y.closed ? <Badge>closed</Badge> : <Badge tone="positive">open</Badge>}
                <button
                  aria-label={`Edit ${y.name}`}
                  onClick={() => setEditingYear(y)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editingYear && (
        <YearModal
          year={editingYear === 'new' ? null : editingYear}
          onClose={() => setEditingYear(null)}
        />
      )}
      {editingPointer && (
        <PointerModal
          pointer={editingPointer === 'new' ? null : editingPointer}
          years={sortedYears}
          onClose={() => setEditingPointer(null)}
        />
      )}
      {closing && (
        <CloseYearModal
          pointer={closing}
          yearName={yearName(closing.academic_year)}
          onClose={() => setClosing(null)}
        />
      )}
      {undoing && (
        <UndoCloseModal
          pointer={undoing}
          oldYearName={yearName(undoing.previous_academic_year)}
          newYearName={yearName(undoing.academic_year)}
          onClose={() => setUndoing(null)}
        />
      )}
    </div>
  )
}

function YearModal({
  year,
  onClose,
}: {
  year: AcademicYearFull | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: year?.name ?? '',
    start_date_bs: year?.start_date_bs ?? '',
    end_date_bs: year?.end_date_bs ?? '',
    remarks: year?.remarks ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: () =>
      year
        ? api.patch(`/api/v1/academics/years/${year.id}/`, form)
        : api.post('/api/v1/academics/years/', form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics'] })
      toast.success(year ? 'Year updated.' : 'Year created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = form.name.trim() && form.start_date_bs && form.end_date_bs

  return (
    <Modal
      open
      onClose={onClose}
      title={year ? `Edit ${year.name}` : 'New academic year'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {year ? 'Save changes' : 'Create year'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={set('name')} autoFocus placeholder="2082" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts (BS)">
            <Input value={form.start_date_bs} onChange={set('start_date_bs')} placeholder="2082-01-01" />
          </Field>
          <Field label="Ends (BS)">
            <Input value={form.end_date_bs} onChange={set('end_date_bs')} placeholder="2082-12-30" />
          </Field>
        </div>
        <Field label="Remarks">
          <Input value={form.remarks} onChange={set('remarks')} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  )
}

function PointerModal({
  pointer,
  years,
  onClose,
}: {
  pointer: YearPointerFull | null
  years: AcademicYearFull[]
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [key, setKey] = useState(pointer?.key ?? 'default')
  const [yearId, setYearId] = useState(pointer?.academic_year ?? '')

  const save = useMutation({
    mutationFn: () =>
      pointer
        ? api.patch(`/api/v1/academics/year-pointers/${pointer.id}/`, {
          key: key.trim(),
          academic_year: yearId,
        })
        : api.post('/api/v1/academics/year-pointers/', {
          key: key.trim(),
          academic_year: yearId,
        }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics'] })
      toast.success(pointer ? 'Pointer updated.' : 'Pointer created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={pointer ? `Edit pointer ${pointer.key}` : 'New year pointer'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={!key.trim() || !yearId}
            onClick={() => save.mutate()}
          >
            {pointer ? 'Save changes' : 'Create pointer'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Key"
          hint="One pointer per faculty group that rolls over independently (e.g. default, +2, bachelor)."
        >
          <Input value={key} onChange={(e) => setKey(e.target.value)} />
        </Field>
        <Field label="Running academic year">
          <Select value={yearId} onChange={(e) => setYearId(e.target.value)}>
            <option value="">Choose a year…</option>
            {years
              .filter((y) => !y.closed)
              .map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>
    </Modal>
  )
}

/**
 * Y1/Y2 close: pick the classes to settle, the fiscal year dues post into,
 * and define the successor year. Per selected class, every student's unpaid
 * balance becomes an opening-balance charge in the new year.
 */
function CloseYearModal({
  pointer,
  yearName,
  onClose,
}: {
  pointer: YearPointerFull
  yearName: string
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const classes = useClassesOfYear(pointer.academic_year)
  const billingYears = useBillingYears()
  const calendar = useCalendar()
  const [picked, setPicked] = useState<Set<string> | null>(null) // null = all
  const [billingYearId, setBillingYearId] = useState('')
  const [newYear, setNewYear] = useState({ name: '', start_date_bs: '', end_date_bs: '' })
  const [confirmText, setConfirmText] = useState('')

  const rows = [...(classes.data ?? [])].sort((a, b) => a.label.localeCompare(b.label))
  const selected = picked ?? new Set(rows.map((r) => r.id))
  const defaultBilling = currentBillingYear(billingYears.data, calendar.data?.today_bs)
  const effectiveBillingYear = billingYearId || defaultBilling?.id || ''

  const toggle = (id: string) =>
    setPicked(() => {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const close = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/academics/year-pointers/${pointer.id}/close/`, {
        classes: [...selected],
        billing_year: effectiveBillingYear,
        new_academic_year: newYear,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics'] })
      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['billing'] })
      toast.success(`Academic year ${yearName} closed. Welcome to ${newYear.name}.`)
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid =
    selected.size > 0 &&
    effectiveBillingYear &&
    newYear.name.trim() &&
    newYear.start_date_bs &&
    newYear.end_date_bs &&
    confirmText.trim().toUpperCase() === 'CLOSE'

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Close ${yearName} (${pointer.key})`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            busy={close.isPending}
            disabled={!valid}
            onClick={() => close.mutate()}
          >
            Close {yearName}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          Closing computes every student's unpaid balance in the selected
          classes and carries it into the new year as an opening-balance
          charge. The closed year stays visible but stops accepting billing.
        </p>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Classes to settle ({selected.size} of {rows.length})
          </h3>
          <div className="max-h-48 overflow-y-auto rounded-xl border border-border">
            <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={c.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 text-sm hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent-strong"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <span className="shrink-0 text-xs text-ink-faint">
                      {c.students_count} students
                    </span>
                  </label>
                </li>
              ))}
              {classes.isLoading && (
                <li className="px-4 py-3 text-sm text-ink-muted">Loading classes…</li>
              )}
            </ul>
          </div>
        </section>

        <Field
          label="Fiscal year for carried dues"
          hint="Opening-balance charges post into this billing year."
        >
          <Select
            value={effectiveBillingYear}
            onChange={(e) => setBillingYearId(e.target.value)}
          >
            <option value="">Choose…</option>
            {(billingYears.data ?? [])
              .filter((y) => !y.closed)
              .map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
          </Select>
        </Field>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            New academic year
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Name">
              <Input
                value={newYear.name}
                onChange={(e) => setNewYear((n) => ({ ...n, name: e.target.value }))}
                placeholder="2083"
              />
            </Field>
            <Field label="Starts (BS)">
              <Input
                value={newYear.start_date_bs}
                onChange={(e) => setNewYear((n) => ({ ...n, start_date_bs: e.target.value }))}
                placeholder="2083-01-01"
              />
            </Field>
            <Field label="Ends (BS)">
              <Input
                value={newYear.end_date_bs}
                onChange={(e) => setNewYear((n) => ({ ...n, end_date_bs: e.target.value }))}
                placeholder="2083-12-30"
              />
            </Field>
          </div>
        </section>

        <Field label='Type CLOSE to confirm' hint="This runs immediately for every selected class.">
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="CLOSE"
          />
        </Field>
      </div>
    </Modal>
  )
}

function UndoCloseModal({
  pointer,
  oldYearName,
  newYearName,
  onClose,
}: {
  pointer: YearPointerFull
  oldYearName: string
  newYearName: string
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const undo = useMutation({
    mutationFn: () => api.post(`/api/v1/academics/year-pointers/${pointer.id}/undo-close/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics'] })
      queryClient.invalidateQueries({ queryKey: ['people'] })
      queryClient.invalidateQueries({ queryKey: ['billing'] })
      toast.success(`Academic year ${oldYearName} reopened.`)
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="Undo last year close"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={undo.isPending} onClick={() => undo.mutate()}>
            Reopen {oldYearName}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        This deletes the carried opening-balance charges, reopens{' '}
        <strong className="text-ink">{oldYearName}</strong> and removes{' '}
        <strong className="text-ink">{newYearName}</strong>. The server refuses
        if the new year already has payments or its own charges — nothing is
        lost in that case.
      </p>
    </Modal>
  )
}
