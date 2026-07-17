import { StatCard } from '../../components/ui'
import { IconBilling } from '../../components/icons'
import { formatMoney } from '../../lib/format'
import { useOpeningBalancesReport, type OpeningBalanceRow } from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  useYearFilter,
  type Col,
} from './shared'

/** Opening balances carried into a year by the closing run (Y1). */

export default function OpeningBalancesPage() {
  const [yearId, , yearControl] = useYearFilter()
  const report = useOpeningBalancesReport(yearId)
  const rows = report.data?.rows ?? []
  const summary = report.data?.summary

  const columns: Array<Col<OpeningBalanceRow>> = [
    { key: 'name', label: 'Student', render: (r) => r.student_name },
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    {
      key: 'amount',
      label: 'Opening balance',
      align: 'right',
      render: (r) => formatMoney(r.amount),
      csv: (r) => r.amount,
    },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:max-w-xs">{yearControl}</div>
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-md">
          <StatCard label="Students" value={summary.count} tone="accent" icon={<IconBilling size={16} />} />
          <StatCard label="Carried forward" value={`Rs. ${formatMoney(summary.total)}`} tone="warning" />
        </div>
      )}
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Opening balance report</h2>
        <ReportActions title="opening-balances" columns={columns} rows={rows} onPrint={() => window.print()} />
      </div>
      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="No opening balances"
        emptyHint="Year-end closing writes each student's carried dues here (negative = prepaid)."
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.student_id} />
        <ReportPrintSheet
          title="Opening balance report"
          meta={summary ? `Academic year ${summary.academic_year}` : undefined}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.student_id}
          totals={[{ label: 'Total', value: `Rs. ${formatMoney(summary?.total ?? 0)}` }]}
        />
      </ReportBody>
    </div>
  )
}
