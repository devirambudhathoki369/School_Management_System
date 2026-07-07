import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  TXN_TYPES,
  useInventoryItems,
  useStockTxns,
} from '../../lib/campus'
import {
  currentBillingYear,
  useBillingYears,
  useCalendar,
  useYearPointers,
} from '../../lib/billing'
import { formatDateBS, formatMoneyRs } from '../../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconPackage, IconPlus, IconTrash } from '../../components/icons'

const TYPE_TONE: Record<string, 'positive' | 'danger' | 'warning' | 'neutral'> = {
  purchase: 'positive',
  issue: 'danger',
  wastage: 'warning',
  adjustment: 'neutral',
}

/** The movements register: every purchase, issue, wastage and adjustment.
 *  Movements are recorded or voided, never edited — like ledger lines. */
export default function MovementsPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const items = useInventoryItems()
  const [itemFilter, setItemFilter] = useState('')
  const [page, setPage] = useState(1)
  const txns = useStockTxns(itemFilter || null, page)
  const [recording, setRecording] = useState(false)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/inventory/transactions/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast.success('Movement voided.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={itemFilter}
          onChange={(e) => {
            setItemFilter(e.target.value)
            setPage(1)
          }}
          aria-label="Item filter"
          className="w-56"
        >
          <option value="">All items</option>
          {(items.data ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button onClick={() => setRecording(true)}>
          <IconPlus size={16} /> Record movement
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {txns.isLoading ? (
          <SkeletonRows rows={8} />
        ) : (txns.data?.results ?? []).length === 0 ? (
          <EmptyState
            icon={<IconPackage size={22} />}
            title="No movements"
            hint="Record purchases in, issues out and corrections."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(txns.data?.results ?? []).map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <Badge tone={TYPE_TONE[t.txn_type] ?? 'neutral'}>{t.txn_type}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {t.item_name}
                    <span className="ml-2 tabular-nums text-ink-muted">
                      {Number(t.quantity).toLocaleString('en-IN')}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {[
                      formatDateBS(t.date_bs),
                      t.supplier,
                      t.party_or_purpose,
                      t.total && Number(t.total) !== 0 && formatMoneyRs(t.total),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <button
                  aria-label="Void movement"
                  onClick={() => {
                    if (window.confirm('Void this movement? Stock recalculates instantly.'))
                      remove.mutate(t.id)
                  }}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
                >
                  <IconTrash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {txns.data && (
        <Pagination
          count={txns.data.count}
          page={page}
          pageSize={50}
          onPage={setPage}
          label="movements"
        />
      )}

      {recording && <MovementModal onClose={() => setRecording(false)} />}
    </div>
  )
}

function MovementModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const items = useInventoryItems()
  const calendar = useCalendar()
  const pointers = useYearPointers()
  const billingYears = useBillingYears()
  const [form, setForm] = useState({
    item: '',
    txn_type: 'purchase',
    quantity: '',
    unit_price: '',
    date_bs: '',
    supplier: '',
    party_or_purpose: '',
    remarks: '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const effectiveDate = form.date_bs || calendar.data?.today_bs || ''
  const academicYear = pointers.data?.[0]?.academic_year ?? ''
  const billingYear = currentBillingYear(billingYears.data, calendar.data?.today_bs)
  const qty = Number(form.quantity) || 0
  const price = Number(form.unit_price) || 0
  const total = qty && price ? Math.abs(qty) * price : 0

  const save = useMutation({
    mutationFn: () =>
      api.post('/api/v1/inventory/transactions/', {
        item: form.item,
        txn_type: form.txn_type,
        quantity: form.quantity,
        unit_price: form.unit_price || null,
        total: total ? String(total) : null,
        date_bs: effectiveDate,
        academic_year: academicYear,
        billing_year: billingYear?.id ?? null,
        supplier: form.supplier,
        party_or_purpose: form.party_or_purpose,
        remarks: form.remarks,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      toast.success('Movement recorded.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const adjustment = form.txn_type === 'adjustment'
  const valid = form.item && form.quantity !== '' && qty !== 0 && effectiveDate && academicYear

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Record movement"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            Record
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Item">
            <Select value={form.item} onChange={set('item')} autoFocus>
              <option value="">Choose an item…</option>
              {(items.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={form.txn_type} onChange={set('txn_type')}>
              {TXN_TYPES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Quantity"
            hint={adjustment ? 'Signed: negative removes stock.' : 'Positive; direction comes from the type.'}
          >
            <Input
              type="number"
              step="0.01"
              min={adjustment ? undefined : '0.01'}
              value={form.quantity}
              onChange={set('quantity')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit price">
              <Input type="number" step="0.01" min="0" value={form.unit_price} onChange={set('unit_price')} />
            </Field>
            <Field label="Total">
              <Input value={total ? total.toFixed(2) : ''} readOnly disabled />
            </Field>
          </div>
          <Field label="Date (BS)">
            <Input value={effectiveDate} onChange={set('date_bs')} />
          </Field>
          {form.txn_type === 'purchase' ? (
            <Field label="Supplier">
              <Input value={form.supplier} onChange={set('supplier')} placeholder="Vendor name" />
            </Field>
          ) : (
            <Field label="Party / purpose">
              <Input
                value={form.party_or_purpose}
                onChange={set('party_or_purpose')}
                placeholder="Science lab, Class 8…"
              />
            </Field>
          )}
        </div>
        <Field label="Remarks">
          <Input value={form.remarks} onChange={set('remarks')} />
        </Field>
      </div>
    </Modal>
  )
}
