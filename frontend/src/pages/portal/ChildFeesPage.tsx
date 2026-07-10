import { useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import {
  useChildFees,
  type FeeCharge,
  type FeePayment,
  type PortalChild,
} from '../../lib/portal'
import { bsMonthShort, formatDateBS, formatMoneyRs, formatReceiptNo } from '../../lib/format'
import { EmptyState, Select, Skeleton } from '../../components/ui'
import { IconReceipt } from '../../components/icons'

/** Fee statement per academic year: what was charged, what was paid, and the
 * standing balance across all years (dues settle with paid + discount, M1). */
export default function ChildFeesPage() {
  const { childId } = useParams()
  const child = useOutletContext<PortalChild>()
  const [year, setYear] = useState('')
  const fees = useChildFees(childId!, year)

  if (fees.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    )
  }
  const data = fees.data
  if (!data) return null
  const dues = Number(data.dues_total)

  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border p-4 ${
          dues > 0 ? 'border-warning/40 bg-warning-soft' : 'border-border bg-surface'
        }`}
      >
        <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          Outstanding balance (all years)
        </p>
        <p className={`mt-1 text-2xl font-semibold tabular-nums ${dues > 0 ? 'text-warning' : 'text-positive'}`}>
          {formatMoneyRs(data.dues_total)}
        </p>
        {dues <= 0 && (
          <p className="mt-0.5 text-xs text-ink-muted">
            {dues < 0 ? 'Paid in advance — nothing owed.' : 'All fees are settled.'}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-ink-muted">
          <span className="mr-4">
            Charged <span className="font-semibold text-ink">{formatMoneyRs(data.year_charged)}</span>
          </span>
          <span>
            Paid <span className="font-semibold text-ink">{formatMoneyRs(data.year_paid)}</span>
          </span>
        </div>
        <Select
          aria-label="Academic year"
          value={data.year}
          onChange={(e) => setYear(e.target.value)}
          className="w-auto min-w-36"
        >
          {data.years.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </Select>
      </div>

      <section aria-label="Receipts">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">
          Payments
        </h3>
        {data.payments.length === 0 ? (
          <EmptyState
            icon={<IconReceipt size={22} />}
            title="No payments this year"
            hint={`Receipts for ${child.first_name} will appear here.`}
          />
        ) : (
          <ul className="space-y-2">
            {data.payments.map((payment) => (
              <PaymentCard key={payment.id} payment={payment} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Charges">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">
          Charges
        </h3>
        {data.charges.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-5 text-sm text-ink-muted">
            No charges were billed this year.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.charges.map((charge) => (
              <ChargeCard key={charge.id} charge={charge} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function LineRows({ lines }: { lines: Array<{ label: string; amount: string }> }) {
  return (
    <ul className="mt-2 space-y-1 border-t border-border pt-2">
      {lines.map((line, i) => (
        <li key={i} className="flex justify-between gap-3 text-xs text-ink-muted">
          <span className="truncate">{line.label}</span>
          <span className="tabular-nums">{formatMoneyRs(line.amount)}</span>
        </li>
      ))}
    </ul>
  )
}

function PaymentCard({ payment }: { payment: FeePayment }) {
  const discount = Number(payment.total_discount)
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            Receipt #{formatReceiptNo(payment.serial)}
            <span className="ml-2 text-xs font-normal capitalize text-ink-muted">
              {payment.mode}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{formatDateBS(payment.date_bs)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-positive">
            {formatMoneyRs(payment.total_paid)}
          </p>
          {discount > 0 && (
            <p className="text-xs text-ink-muted">
              + {formatMoneyRs(payment.total_discount)} discount
            </p>
          )}
        </div>
      </div>
      {payment.lines.length > 0 && <LineRows lines={payment.lines} />}
    </li>
  )
}

function ChargeCard({ charge }: { charge: FeeCharge }) {
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {charge.months.length > 0
              ? charge.months.map((m) => bsMonthShort(m)).join(', ')
              : charge.remarks || 'Fee charge'}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">{formatDateBS(charge.date_bs)}</p>
        </div>
        <p className="text-sm font-semibold tabular-nums">{formatMoneyRs(charge.total)}</p>
      </div>
      {charge.lines.length > 0 && <LineRows lines={charge.lines} />}
    </li>
  )
}
