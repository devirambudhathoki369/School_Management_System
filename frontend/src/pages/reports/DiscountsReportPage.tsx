import { useState } from 'react'
import ClassPicker from '../../components/ClassPicker'
import { Field, Input, StatCard } from '../../components/ui'
import { IconPercent } from '../../components/icons'
import { formatMoney, formatReceiptNo } from '../../lib/format'
import {
  usePaymentDiscountsReport,
  useStandingDiscountsReport,
  type PaymentDiscountRow,
  type StandingDiscountRow,
} from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  useYearFilter,
  type Col,
} from './shared'

/**
 * Discounts, both kinds on one page: standing grants (the D2 year-scoped
 * waivers) and receipt-time discounts actually allowed at the counter.
 */

const MODES = [
  { id: 'standing', label: 'Standing discounts' },
  { id: 'payments', label: 'Given on receipts' },
] as const

export default function DiscountsReportPage() {
  const [mode, setMode] = useState<'standing' | 'payments'>('standing')
  return (
    <div>
      <div className="mb-4 flex w-max gap-1 rounded-xl bg-surface-sunken p-1">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            className={`flex h-9 items-center rounded-lg px-3.5 text-sm font-medium transition-colors ${
              mode === m.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'standing' ? <StandingView /> : <PaymentsView />}
    </div>
  )
}

function StandingView() {
  const [yearId, , yearControl] = useYearFilter()
  const [classId, setClassId] = useState('')
  const report = useStandingDiscountsReport({
    academic_year: yearId || undefined,
    class_info: classId || undefined,
  })
  const rows = report.data?.rows ?? []

  const columns: Array<Col<StandingDiscountRow>> = [
    { key: 'name', label: 'Student', render: (r) => r.name },
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    { key: 'title', label: 'Fee title', render: (r) => r.fee_title },
    {
      key: 'rate',
      label: 'Discount',
      align: 'right',
      render: (r) =>
        r.percentage != null && Number(r.percentage) > 0
          ? `${Number(r.percentage)}%`
          : `Rs. ${formatMoney(r.flat_amount ?? 0)}`,
      csv: (r) => (r.percentage != null && Number(r.percentage) > 0 ? `${r.percentage}%` : r.flat_amount ?? ''),
    },
    { key: 'year', label: 'Year', render: (r) => r.academic_year },
    { key: 'remarks', label: 'Remarks', render: (r) => r.remarks },
  ]

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {yearControl}
        <div className="sm:col-span-2 lg:col-span-2">
          <ClassPicker classId={classId} onChange={(id) => setClassId(id)} allowAnyClass yearId={yearId} />
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-xs">
        <StatCard
          label="Active grants"
          value={report.data?.summary.count ?? '—'}
          tone="accent"
          icon={<IconPercent size={16} />}
        />
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Discount history</h2>
        <ReportActions title="discount-history" columns={columns} rows={rows} onPrint={() => window.print()} />
      </div>
      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="No standing discounts"
        emptyHint="Grants made under Billing → Discounts appear here per year."
        truncated={report.data?.truncated}
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        <ReportPrintSheet
          title="Discount history"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
        />
      </ReportBody>
    </>
  )
}

function PaymentsView() {
  const [yearId, , yearControl] = useYearFilter()
  const [fromBs, setFromBs] = useState('')
  const [toBs, setToBs] = useState('')
  const rangeReady = (fromBs === '' && toBs === '') || (fromBs !== '' && toBs !== '')
  const report = usePaymentDiscountsReport(
    {
      academic_year: yearId,
      from_bs: fromBs || undefined,
      to_bs: toBs || undefined,
    },
    !!yearId && rangeReady,
  )
  const rows = report.data?.rows ?? []
  const summary = report.data?.summary

  const columns: Array<Col<PaymentDiscountRow>> = [
    { key: 'serial', label: 'Receipt', render: (r) => formatReceiptNo(r.serial), csv: (r) => r.serial ?? '' },
    { key: 'date', label: 'Date (BS)', render: (r) => r.date_bs },
    { key: 'name', label: 'Student', render: (r) => r.name },
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    {
      key: 'split',
      label: 'Discounted titles',
      render: (r) => r.lines.map((l) => `${l.label} ${formatMoney(l.discount)}`).join(' · '),
    },
    { key: 'cashier', label: 'Cashier', render: (r) => r.cashier },
    {
      key: 'discount',
      label: 'Discount',
      align: 'right',
      render: (r) => formatMoney(r.total_discount),
      csv: (r) => r.total_discount,
    },
  ]

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        {yearControl}
        <Field label="From (BS)">
          <Input value={fromBs} onChange={(e) => setFromBs(e.target.value)} placeholder="2082-01-01" />
        </Field>
        <Field label="To (BS)">
          <Input value={toBs} onChange={(e) => setToBs(e.target.value)} placeholder="2082-12-30" />
        </Field>
      </div>
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-md">
          <StatCard label="Receipts with discount" value={summary.count} tone="accent" icon={<IconPercent size={16} />} />
          <StatCard label="Discount allowed" value={`Rs. ${formatMoney(summary.total_discount)}`} tone="warning" />
        </div>
      )}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Payment discount report</h2>
        <ReportActions title="payment-discounts" columns={columns} rows={rows} onPrint={() => window.print()} />
      </div>
      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="No discounted receipts"
        emptyHint="Receipts where the cashier allowed a discount will show here."
        truncated={report.data?.truncated}
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        <ReportPrintSheet
          title="Payment discount report"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totals={[{ label: 'Discount', value: `Rs. ${formatMoney(summary?.total_discount ?? 0)}` }]}
        />
      </ReportBody>
    </>
  )
}
