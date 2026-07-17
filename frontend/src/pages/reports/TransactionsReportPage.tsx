import { useState } from 'react'
import ClassPicker from '../../components/ClassPicker'
import { Badge, Field, Input, Select, StatCard } from '../../components/ui'
import { IconReceipt } from '../../components/icons'
import { useAuth } from '../../lib/auth'
import { formatMoney, formatReceiptNo } from '../../lib/format'
import { useTransactionsReport, type TransactionRow } from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  useYearFilter,
  type Col,
} from './shared'

/**
 * Transactions history — the full payment register with per-receipt fee
 * breakdown. An explicit BS date range REPLACES the year filter (legacy
 * rule), and the class filter follows the payment-time snapshot (M3).
 */

export default function TransactionsReportPage() {
  const { account } = useAuth()
  const [yearId, , yearControl] = useYearFilter()
  const [classId, setClassId] = useState('')
  const [fromBs, setFromBs] = useState('')
  const [toBs, setToBs] = useState('')
  const [kind, setKind] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)

  const rangeReady = (fromBs === '' && toBs === '') || (fromBs !== '' && toBs !== '')
  const report = useTransactionsReport(
    {
      academic_year: yearId,
      class_info: classId || undefined,
      from_bs: fromBs || undefined,
      to_bs: toBs || undefined,
      kind: kind || undefined,
      include_inactive: includeInactive ? 'true' : undefined,
    },
    !!yearId && rangeReady,
  )

  const rows = report.data?.rows ?? []
  const summary = report.data?.summary

  const columns: Array<Col<TransactionRow>> = [
    {
      key: 'serial',
      label: 'Receipt',
      render: (r) => formatReceiptNo(r.serial),
      csv: (r) => r.serial ?? '',
    },
    { key: 'date', label: 'Date (BS)', render: (r) => r.date_bs },
    {
      key: 'name',
      label: 'Name',
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.name}
          {!r.is_active && <Badge tone="danger">deleted</Badge>}
        </span>
      ),
      csv: (r) => r.name,
    },
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    {
      key: 'particulars',
      label: 'Particulars',
      render: (r) => r.lines.map((l) => l.label).join(', '),
    },
    { key: 'mode', label: 'Mode', render: (r) => r.mode },
    { key: 'cashier', label: 'Cashier', render: (r) => r.cashier },
    {
      key: 'discount',
      label: 'Discount',
      align: 'right',
      render: (r) => (Number(r.total_discount) > 0 ? formatMoney(r.total_discount) : '—'),
      csv: (r) => r.total_discount,
    },
    {
      key: 'paid',
      label: 'Paid',
      align: 'right',
      render: (r) => formatMoney(r.total_paid),
      csv: (r) => r.total_paid,
    },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {yearControl}
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All receipts</option>
            <option value="regular">Fee receipts</option>
            <option value="cash_receipt">Cash receipts</option>
          </Select>
        </Field>
        <div className="sm:col-span-2 lg:col-span-1">
          <ClassPicker classId={classId} onChange={(id) => setClassId(id)} allowAnyClass yearId={yearId} />
        </div>
        <Field label="From (BS) — overrides year">
          <Input value={fromBs} onChange={(e) => setFromBs(e.target.value)} placeholder="2082-01-01" />
        </Field>
        <Field label="To (BS)">
          <Input value={toBs} onChange={(e) => setToBs(e.target.value)} placeholder="2082-12-30" />
        </Field>
        {account?.role === 'admin' && (
          <label className="flex items-end gap-2 pb-2.5 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              className="size-4 accent-accent"
            />
            Include deleted receipts
          </label>
        )}
      </div>

      {summary && (
        <div
          className={`mb-4 grid grid-cols-2 gap-3 ${
            Number(summary.edu_fee) > 0 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
          }`}
        >
          <StatCard label="Receipts" value={summary.count} tone="accent" icon={<IconReceipt size={16} />} />
          <StatCard label="Collected" value={`Rs. ${formatMoney(summary.total_paid)}`} tone="positive" />
          <StatCard label="Discount allowed" value={`Rs. ${formatMoney(summary.total_discount)}`} tone="warning" />
          {Number(summary.edu_fee) > 0 && (
            <StatCard
              label="Education Equality Fee"
              value={`Rs. ${formatMoney(summary.edu_fee)}`}
              detail="3% govt. levy, on top of receipts"
            />
          )}
          <StatCard
            label="Serial range"
            value={
              summary.serial_from != null ? `${summary.serial_from} – ${summary.serial_to}` : '—'
            }
            detail={summary.date_from ? `${summary.date_from} → ${summary.date_to}` : undefined}
          />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Transactions history</h2>
        <ReportActions
          title="transactions-history"
          columns={columns}
          rows={rows}
          onPrint={() => window.print()}
        />
      </div>

      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="No receipts match"
        emptyHint="Adjust the year, class or date range and the register fills in."
        truncated={report.data?.truncated}
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        <ReportPrintSheet
          title="Transactions history"
          meta={
            summary?.date_from
              ? `${summary.date_from} to ${summary.date_to} · ${summary.count} receipts`
              : undefined
          }
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totals={[
            { label: 'Collected', value: `Rs. ${formatMoney(summary?.total_paid ?? 0)}` },
            { label: 'Discount', value: `Rs. ${formatMoney(summary?.total_discount ?? 0)}` },
          ]}
        />
      </ReportBody>
    </div>
  )
}
