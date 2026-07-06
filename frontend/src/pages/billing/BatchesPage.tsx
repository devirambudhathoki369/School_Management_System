import { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  currentBillingYear,
  useBillingYears,
  useCalendar,
  useClasses,
  useYearPointers,
  type ChargeBatch,
  type Paginated,
} from '../../lib/billing'
import { BS_MONTHS, bsMonthName, formatDateBS } from '../../lib/format'
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
import { IconLayers, IconPlus } from '../../components/icons'

/**
 * Billing runs (M8): one run charges every running student of a class for
 * the chosen months, resolving each student's fee plan and standing
 * discounts server-side. Runs are immutable once executed — the register
 * below is history, not something to edit.
 */

const PAGE_SIZE = 50

export default function BatchesPage() {
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'batches', page],
    queryFn: async () =>
      (
        await api.get<Paginated<ChargeBatch>>('/api/v1/billing/charge-batches/', {
          params: { page },
        })
      ).data,
    placeholderData: keepPreviousData,
  })

  const rows = data?.results ?? []

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <IconPlus size={16} /> Run billing
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconLayers size={22} />}
            title="No billing runs yet"
            hint="A run posts one charge per running student of a class, built from the class fee plan."
            action={
              <Button onClick={() => setCreating(true)}>
                <IconPlus size={16} /> Run the first billing
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((batch) => (
              <li key={batch.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {batch.class_label}
                    <span className="ml-2 text-xs font-normal text-ink-faint">
                      AY {batch.academic_year_name}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {formatDateBS(batch.date_bs)}
                    {batch.months.length > 0 && <> · {batch.months.map(bsMonthName).join(', ')}</>}
                    {batch.remarks && <> · {batch.remarks}</>}
                  </p>
                </div>
                <Badge tone="accent">
                  {batch.charge_count.toLocaleString('en-IN')} charge{batch.charge_count === 1 ? '' : 's'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && (
        <Pagination count={data.count} page={page} pageSize={PAGE_SIZE} onPage={setPage} label="runs" />
      )}

      {creating && <RunModal onClose={() => setCreating(false)} />}
    </div>
  )
}

function RunModal({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const calendar = useCalendar()
  const billingYears = useBillingYears()
  const pointers = useYearPointers()
  const runningYears = useMemo(
    () => [...new Set((pointers.data ?? []).map((p) => p.academic_year))],
    [pointers.data],
  )
  const classes = useClasses(runningYears)

  const [classId, setClassId] = useState('')
  const [months, setMonths] = useState<Set<number>>(new Set())
  const [dateBs, setDateBs] = useState('')
  const [remarks, setRemarks] = useState('')

  const billingYear = currentBillingYear(billingYears.data, calendar.data?.today_bs)
  const selectedClass = classes.data?.find((c) => c.id === classId)
  const date = dateBs || calendar.data?.today_bs || ''

  const run = useMutation({
    mutationFn: async () =>
      (
        await api.post<ChargeBatch>('/api/v1/billing/charge-batches/', {
          class_info: classId,
          months: [...months].sort((a, b) => a - b),
          date_bs: date,
          academic_year: selectedClass!.academic_year,
          billing_year: billingYear!.id,
          remarks,
        })
      ).data,
    onSuccess: (batch) => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'batches'] })
      queryClient.invalidateQueries({ queryKey: ['billing', 'dues'] })
      toast.success(
        `Billing run posted — ${batch.charge_count.toLocaleString('en-IN')} students charged.`,
      )
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="Run billing"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={run.isPending}
            disabled={!classId || months.size === 0 || !date || !billingYear}
            onClick={() => run.mutate()}
          >
            Charge the class
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Class"
          error={classes.isError ? 'Classes unavailable — this needs the academics permission.' : undefined}
        >
          <Select value={classId} onChange={(e) => setClassId(e.target.value)} autoFocus>
            <option value="">Choose a class…</option>
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Months to charge"
          hint="Only fee titles marked for these months are charged; each is billed once per month."
        >
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
                  {label.slice(0, 3)}
                </button>
              )
            })}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date (BS)">
            <Input value={date} onChange={(e) => setDateBs(e.target.value)} placeholder="2082-03-21" />
          </Field>
          <Field label="Remarks">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
          </Field>
        </div>

        {billingYear && (
          <p className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-ink-muted">
            Charges post to fiscal year <span className="font-medium">{billingYear.name}</span>.
            A run cannot be edited afterwards — dues corrections go through receipts.
          </p>
        )}
      </div>
    </Modal>
  )
}
