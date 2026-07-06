import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  useClasses,
  useFeeSchedules,
  useFeeTitles,
  useYearPointers,
  type FeeSchedule,
  type FeeTitle,
} from '../../lib/billing'
import { BS_MONTHS, bsMonthName, bsMonthShort, formatMoney } from '../../lib/format'
import {
  AmountInput,
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
import { IconPencil, IconPlus, IconSliders, IconTrash } from '../../components/icons'

/**
 * Fee plan: the titles a school charges under, and how much each class pays
 * per title (M5/M6 — one fee per class+title; section-specific rows override
 * the generic class row at charge time).
 */

export default function FeesPage() {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <TitlesPanel />
      <SchedulePanel />
    </div>
  )
}

// ------------------------------------------------------------- titles

function TitlesPanel() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const titles = useFeeTitles()
  const [editing, setEditing] = useState<FeeTitle | 'new' | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/billing/fee-titles/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'fee-titles'] })
      toast.success('Fee title removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold">Fee titles</h2>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New title
        </Button>
      </div>

      {titles.isLoading ? (
        <SkeletonRows rows={6} />
      ) : (titles.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<IconSliders size={22} />}
          title="No fee titles yet"
          hint="Titles are what receipts and charges are itemised under — tuition, exam fee, transport…"
          action={
            <Button onClick={() => setEditing('new')}>
              <IconPlus size={16} /> Create the first title
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {titles.data!.map((title) => (
            <li key={title.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{title.name}</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {title.months.length === 0
                    ? 'One-off / any month'
                    : title.months.length === 12
                      ? 'Every month'
                      : title.months.map(bsMonthName).join(', ')}
                </p>
              </div>
              {title.kind === 'cash_receipt' && <Badge>cash receipt</Badge>}
              <button
                aria-label={`Edit ${title.name}`}
                onClick={() => setEditing(title)}
                className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
              >
                <IconPencil size={16} />
              </button>
              <button
                aria-label={`Delete ${title.name}`}
                onClick={() => {
                  if (window.confirm(`Delete fee title “${title.name}”?`)) remove.mutate(title.id)
                }}
                className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && <TitleModal title={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function TitleModal({ title, onClose }: { title: FeeTitle | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(title?.name ?? '')
  const [kind, setKind] = useState<FeeTitle['kind']>(title?.kind ?? 'regular')
  const [months, setMonths] = useState<Set<number>>(new Set(title?.months ?? []))

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), kind, months: [...months].sort((a, b) => a - b) }
      if (title) return api.patch(`/api/v1/billing/fee-titles/${title.id}/`, payload)
      return api.post('/api/v1/billing/fee-titles/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'fee-titles'] })
      toast.success(title ? 'Fee title updated.' : 'Fee title created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={title ? 'Edit fee title' : 'New fee title'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            {title ? 'Save changes' : 'Create title'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tuition fee" autoFocus />
        </Field>
        <Field label="Kind" hint="Cash-receipt titles are for standalone income, not student dues.">
          <Select value={kind} onChange={(e) => setKind(e.target.value as FeeTitle['kind'])}>
            <option value="regular">Regular fee</option>
            <option value="cash_receipt">Cash receipt</option>
          </Select>
        </Field>
        <Field label="Billed in months" hint="Used by billing runs to pick which titles apply. Leave empty for one-off fees.">
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
            {BS_MONTHS.map((label, i) => {
              const value = i + 1
              const on = months.has(value)
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setMonths((m) => {
                      const next = new Set(m)
                      if (on) next.delete(value)
                      else next.add(value)
                      return next
                    })
                  }
                  className={`h-9 rounded-lg border text-[13px] font-medium transition-colors ${
                    on
                      ? 'border-accent bg-accent-soft text-accent-strong'
                      : 'border-border text-ink-muted hover:border-accent'
                  }`}
                >
                  {bsMonthShort(value)}
                </button>
              )
            })}
          </div>
        </Field>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------- schedule

function SchedulePanel() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const pointers = useYearPointers()
  const runningYears = useMemo(
    () => [...new Set((pointers.data ?? []).map((p) => p.academic_year))],
    [pointers.data],
  )
  const classes = useClasses(runningYears)
  const titles = useFeeTitles()
  const [classId, setClassId] = useState('')
  const [editing, setEditing] = useState<FeeSchedule | 'new' | null>(null)
  const schedules = useFeeSchedules(classId || null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/billing/fees/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'fees'] })
      toast.success('Fee removed from the class plan.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold">Class fee plan</h2>
        <Button variant="secondary" disabled={!classId} onClick={() => setEditing('new')}>
          <IconPlus size={16} /> Add fee
        </Button>
      </div>

      <div className="border-b border-border px-4 py-3 sm:px-5">
        <Select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
          <option value="">
            {classes.isError
              ? 'Classes unavailable (needs the academics permission)'
              : 'Choose a class…'}
          </option>
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>

      {!classId ? (
        <EmptyState
          title="Pick a class"
          hint="Each class carries its own amounts per fee title; a section-specific row overrides the class-wide one."
        />
      ) : schedules.isLoading ? (
        <SkeletonRows rows={5} />
      ) : (schedules.data?.length ?? 0) === 0 ? (
        <EmptyState
          title="No fees on this class yet"
          action={
            <Button onClick={() => setEditing('new')}>
              <IconPlus size={16} /> Add the first fee
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {schedules.data!.map((fee) => (
            <li key={fee.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{fee.title_name}</p>
              <p className="text-sm font-semibold tabular-nums">{formatMoney(fee.amount)}</p>
              <button
                aria-label={`Edit ${fee.title_name}`}
                onClick={() => setEditing(fee)}
                className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
              >
                <IconPencil size={16} />
              </button>
              <button
                aria-label={`Remove ${fee.title_name}`}
                onClick={() => {
                  if (window.confirm(`Remove “${fee.title_name}” from this class?`))
                    remove.mutate(fee.id)
                }}
                className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && classId && (
        <ScheduleModal
          classId={classId}
          schedule={editing === 'new' ? null : editing}
          titles={(titles.data ?? []).filter(
            (t) =>
              t.kind === 'regular' &&
              (editing !== 'new'
                ? true
                : !(schedules.data ?? []).some((s) => s.fee_title === t.id)),
          )}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}

function ScheduleModal({
  classId,
  schedule,
  titles,
  onClose,
}: {
  classId: string
  schedule: FeeSchedule | null
  titles: FeeTitle[]
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [feeTitle, setFeeTitle] = useState(schedule?.fee_title ?? '')
  const [amount, setAmount] = useState(schedule?.amount ?? '')

  const save = useMutation({
    mutationFn: async () => {
      if (schedule) return api.patch(`/api/v1/billing/fees/${schedule.id}/`, { amount })
      return api.post('/api/v1/billing/fees/', { class_info: classId, fee_title: feeTitle, amount })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'fees'] })
      toast.success('Class fee plan updated.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={schedule ? `Edit ${schedule.title_name}` : 'Add fee to class'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={(!schedule && !feeTitle) || !amount || Number(amount) < 0}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!schedule && (
          <Field label="Fee title">
            <Select value={feeTitle} onChange={(e) => setFeeTitle(e.target.value)} autoFocus>
              <option value="">Choose a title…</option>
              {titles.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Amount (Rs.)">
          <AmountInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
