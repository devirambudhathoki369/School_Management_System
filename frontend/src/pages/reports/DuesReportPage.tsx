import { useState } from 'react'
import { Field, Input, Select, StatCard } from '../../components/ui'
import { IconBilling } from '../../components/icons'
import { formatMoney } from '../../lib/format'
import { useDuesReport, type DuesRow } from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  useYearFilter,
  type Col,
} from './shared'

/**
 * Overall remaining dues, classwise: what was charged (debit) against what
 * came back as cash + waived discount (credit, M1). Rows group by each
 * student's CURRENT class — the legacy contract for this sheet.
 */

export default function DuesReportPage() {
  const [yearId, , yearControl] = useYearFilter()
  const [status, setStatus] = useState('running')
  const [fromBs, setFromBs] = useState('')
  const [toBs, setToBs] = useState('')

  const rangeReady = (fromBs === '' && toBs === '') || (fromBs !== '' && toBs !== '')
  const report = useDuesReport(
    {
      academic_year: yearId,
      status,
      from_bs: fromBs || undefined,
      to_bs: toBs || undefined,
    },
    !!yearId && rangeReady,
  )
  const rows = report.data?.rows ?? []
  const summary = report.data?.summary

  const columns: Array<Col<DuesRow>> = [
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    {
      key: 'debit',
      label: 'Debit (charged)',
      align: 'right',
      render: (r) => formatMoney(r.debit),
      csv: (r) => r.debit,
    },
    {
      key: 'credit',
      label: 'Credit (paid + discount)',
      align: 'right',
      render: (r) => formatMoney(r.credit),
      csv: (r) => r.credit,
    },
    {
      key: 'balance',
      label: 'Balance',
      align: 'right',
      render: (r) => formatMoney(r.balance),
      csv: (r) => r.balance,
    },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {yearControl}
        <Field label="Student status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="running">Running</option>
            <option value="left">Left</option>
            <option value="graduated">Graduated</option>
          </Select>
        </Field>
        <Field label="From (BS)">
          <Input value={fromBs} onChange={(e) => setFromBs(e.target.value)} placeholder="2082-01-01" />
        </Field>
        <Field label="To (BS)">
          <Input value={toBs} onChange={(e) => setToBs(e.target.value)} placeholder="2082-12-30" />
        </Field>
      </div>

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard label="Charged" value={`Rs. ${formatMoney(summary.debit)}`} tone="accent" icon={<IconBilling size={16} />} />
          <StatCard label="Settled" value={`Rs. ${formatMoney(summary.credit)}`} tone="positive" />
          <StatCard label="Outstanding" value={`Rs. ${formatMoney(summary.balance)}`} tone="warning" />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Overall remaining dues</h2>
        <ReportActions title="remaining-dues" columns={columns} rows={rows} onPrint={() => window.print()} />
      </div>

      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="Nothing outstanding"
        emptyHint="No charges or payments fall inside this year for the chosen status."
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.class_info} />
        <ReportPrintSheet
          title="Overall remaining dues"
          meta={summary ? `Academic year ${summary.academic_year}` : undefined}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.class_info}
          totals={[
            { label: 'Debit', value: `Rs. ${formatMoney(summary?.debit ?? 0)}` },
            { label: 'Credit', value: `Rs. ${formatMoney(summary?.credit ?? 0)}` },
            { label: 'Balance', value: `Rs. ${formatMoney(summary?.balance ?? 0)}` },
          ]}
        />
      </ReportBody>
    </div>
  )
}
