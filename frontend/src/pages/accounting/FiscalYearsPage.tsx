import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import {
  useFiscalYears,
  useLedgerGroups,
  useLedgers,
  type FiscalYear,
} from '../../lib/accounting'
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
import { IconCalendar, IconPencil, IconPlus } from '../../components/icons'

/**
 * Accounting fiscal years (per school, chained by `previous`). Closing rolls
 * every ledger's closing balance into next year's openings and settles
 * income/expense into a retained-earnings ledger; undo is server-guarded
 * while the new year is untouched. Admin-only, like every year-end action.
 */
export default function FiscalYearsPage() {
  const { account } = useAuth()
  const isAdmin = account?.role === 'admin'
  const years = useFiscalYears()
  const [editing, setEditing] = useState<FiscalYear | 'new' | null>(null)
  const [closing, setClosing] = useState<FiscalYear | null>(null)
  const [undoing, setUndoing] = useState<FiscalYear | null>(null)

  const rows = years.data ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-semibold">Fiscal years</h3>
            <p className="mt-0.5 text-xs text-ink-muted">
              The accounting calendar — vouchers post into the open year.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setEditing('new')}>
            <IconPlus size={16} /> New year
          </Button>
        </div>
        {years.isLoading ? (
          <SkeletonRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconCalendar size={22} />}
            title="No fiscal years yet"
            hint="Create one before posting vouchers."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((year) => (
              <li
                key={year.id}
                className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{year.name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {formatDateBS(year.start_date_bs)} — {formatDateBS(year.end_date_bs)}
                    {year.remarks ? ` · ${year.remarks}` : ''}
                  </p>
                </div>
                {year.closed ? <Badge>closed</Badge> : <Badge tone="positive">open</Badge>}
                <div className="flex shrink-0 items-center gap-2">
                  {!year.closed && (
                    <button
                      aria-label={`Edit ${year.name}`}
                      onClick={() => setEditing(year)}
                      className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                    >
                      <IconPencil size={16} />
                    </button>
                  )}
                  {isAdmin && year.closed && (
                    <Button variant="secondary" onClick={() => setUndoing(year)}>
                      Undo close
                    </Button>
                  )}
                  {isAdmin && !year.closed && (
                    <Button variant="secondary" onClick={() => setClosing(year)}>
                      Close year…
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <YearModal
          year={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
      {closing && <CloseModal year={closing} onClose={() => setClosing(null)} />}
      {undoing && <UndoModal year={undoing} onClose={() => setUndoing(null)} />}
    </div>
  )
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['accounting'] })
}

function YearModal({ year, onClose }: { year: FiscalYear | null; onClose: () => void }) {
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
        ? api.patch(`/api/v1/accounting/fiscal-years/${year.id}/`, form)
        : api.post('/api/v1/accounting/fiscal-years/', form),
    onSuccess: () => {
      invalidate(queryClient)
      toast.success(year ? 'Fiscal year updated.' : 'Fiscal year created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = form.name.trim() && form.start_date_bs && form.end_date_bs

  return (
    <Modal
      open
      onClose={onClose}
      title={year ? `Edit ${year.name}` : 'New fiscal year'}
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
          <Input value={form.name} onChange={set('name')} autoFocus placeholder="FY 2082/83" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts (BS)">
            <Input value={form.start_date_bs} onChange={set('start_date_bs')} placeholder="2082-04-01" />
          </Field>
          <Field label="Ends (BS)">
            <Input value={form.end_date_bs} onChange={set('end_date_bs')} placeholder="2083-03-30" />
          </Field>
        </div>
        <Field label="Remarks">
          <Input value={form.remarks} onChange={set('remarks')} placeholder="Optional" />
        </Field>
      </div>
    </Modal>
  )
}

function CloseModal({ year, onClose }: { year: FiscalYear; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const ledgers = useLedgers()
  const groups = useLedgerGroups()
  const [next, setNext] = useState({ name: '', start_date_bs: '', end_date_bs: '' })
  const [retained, setRetained] = useState('')
  const [confirmText, setConfirmText] = useState('')

  const equityCodes = new Set(
    (groups.data ?? []).filter((g) => g.category === 'equity').map((g) => g.code),
  )
  const equityLedgers = (ledgers.data ?? []).filter((l) => equityCodes.has(l.group))
  const options = equityLedgers.length > 0 ? equityLedgers : (ledgers.data ?? [])

  const close = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/accounting/fiscal-years/${year.id}/close/`, {
        ...next,
        retained_ledger: retained,
      }),
    onSuccess: () => {
      invalidate(queryClient)
      toast.success(`${year.name} closed. Openings carried into ${next.name}.`)
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid =
    next.name.trim() && next.start_date_bs && next.end_date_bs && retained &&
    confirmText.trim().toUpperCase() === 'CLOSE'

  return (
    <Modal
      open
      onClose={onClose}
      title={`Close ${year.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={close.isPending} disabled={!valid} onClick={() => close.mutate()}>
            Close {year.name}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          Closing carries every ledger's balance into the new year's openings
          and settles the year's profit into the retained-earnings ledger. The
          closed year stops accepting vouchers.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="New year name">
            <Input
              value={next.name}
              onChange={(e) => setNext((n) => ({ ...n, name: e.target.value }))}
              placeholder="FY 2083/84"
            />
          </Field>
          <Field label="Starts (BS)">
            <Input
              value={next.start_date_bs}
              onChange={(e) => setNext((n) => ({ ...n, start_date_bs: e.target.value }))}
              placeholder="2083-04-01"
            />
          </Field>
          <Field label="Ends (BS)">
            <Input
              value={next.end_date_bs}
              onChange={(e) => setNext((n) => ({ ...n, end_date_bs: e.target.value }))}
              placeholder="2084-03-30"
            />
          </Field>
        </div>
        <Field
          label="Retained earnings ledger"
          hint="The year's net profit/loss settles into this equity ledger."
        >
          <Select value={retained} onChange={(e) => setRetained(e.target.value)}>
            <option value="">Choose a ledger…</option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type CLOSE to confirm">
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

function UndoModal({ year, onClose }: { year: FiscalYear; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const undo = useMutation({
    mutationFn: () => api.post(`/api/v1/accounting/fiscal-years/${year.id}/undo-close/`),
    onSuccess: () => {
      invalidate(queryClient)
      toast.success(`${year.name} reopened.`)
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reopen ${year.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" busy={undo.isPending} onClick={() => undo.mutate()}>
            Reopen {year.name}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-muted">
        This removes the successor year's carried openings and reopens{' '}
        <strong className="text-ink">{year.name}</strong>. The server refuses
        if the new year already has its own vouchers — nothing is lost in
        that case.
      </p>
    </Modal>
  )
}
