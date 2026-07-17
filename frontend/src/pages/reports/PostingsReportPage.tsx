import { useState } from 'react'
import ClassPicker from '../../components/ClassPicker'
import { StatCard } from '../../components/ui'
import { IconLayers } from '../../components/icons'
import { bsMonthShort, formatMoney } from '../../lib/format'
import { usePostingsReport, type PostingRow } from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  useYearFilter,
  type Col,
} from './shared'

/** Billing-run history: every charge batch, its months and title breakdown. */

export default function PostingsReportPage() {
  const [yearId, , yearControl] = useYearFilter()
  const [classId, setClassId] = useState('')

  const report = usePostingsReport({
    academic_year: yearId || undefined,
    class_info: classId || undefined,
  })
  const rows = report.data?.rows ?? []
  const summary = report.data?.summary

  const columns: Array<Col<PostingRow>> = [
    { key: 'date', label: 'Date (BS)', render: (r) => r.date_bs },
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    {
      key: 'months',
      label: 'Months',
      render: (r) => r.months.map((m) => bsMonthShort(m)).join(', '),
    },
    {
      key: 'breakdown',
      label: 'Breakdown',
      render: (r) => r.lines.map((l) => `${l.label} ${formatMoney(l.amount)}`).join(' · '),
    },
    { key: 'students', label: 'Students', align: 'right', render: (r) => r.charge_count },
    { key: 'by', label: 'Posted by', render: (r) => r.posted_by },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      render: (r) => formatMoney(r.total),
      csv: (r) => r.total,
    },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {yearControl}
        <div className="sm:col-span-2 lg:col-span-2">
          <ClassPicker classId={classId} onChange={(id) => setClassId(id)} allowAnyClass yearId={yearId} />
        </div>
      </div>

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-md">
          <StatCard label="Billing runs" value={summary.count} tone="accent" icon={<IconLayers size={16} />} />
          <StatCard label="Charged" value={`Rs. ${formatMoney(summary.total)}`} tone="positive" />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Posting history</h2>
        <ReportActions
          title="posting-history"
          columns={columns}
          rows={rows}
          onPrint={() => window.print()}
        />
      </div>

      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="No billing runs"
        emptyHint="Runs posted from Billing → Billing runs appear here with their breakdown."
        truncated={report.data?.truncated}
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        <ReportPrintSheet
          title="Ledger posting history"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          totals={[{ label: 'Charged', value: `Rs. ${formatMoney(summary?.total ?? 0)}` }]}
        />
      </ReportBody>
    </div>
  )
}
