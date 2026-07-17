import { useState } from 'react'
import ClassPicker from '../../components/ClassPicker'
import { Field, Input, Select, StatCard } from '../../components/ui'
import { IconStudents } from '../../components/icons'
import { formatMoney } from '../../lib/format'
import { useStudentLedgersReport, type StudentLedgerRow } from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  useYearFilter,
  type Col,
} from './shared'

/**
 * Overall student ledgers: per-student debit / credit / balance with the
 * guardian contact for follow-up calls. The balance bounds turn it into the
 * legacy "students balance range" finder.
 */

export default function LedgersReportPage() {
  const [yearId, , yearControl] = useYearFilter()
  const [classId, setClassId] = useState('')
  const [status, setStatus] = useState('running')
  const [balanceGt, setBalanceGt] = useState('')
  const [balanceLt, setBalanceLt] = useState('')

  const report = useStudentLedgersReport(
    {
      academic_year: yearId,
      class_info: classId || undefined,
      status,
      balance_gt: balanceGt || undefined,
      balance_lt: balanceLt || undefined,
    },
    !!yearId,
  )
  const rows = report.data?.rows ?? []
  const summary = report.data?.summary

  const columns: Array<Col<StudentLedgerRow>> = [
    { key: 'name', label: 'Student', render: (r) => r.name },
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    { key: 'guardian', label: 'Guardian', render: (r) => r.guardian_name },
    { key: 'contact', label: 'Contact', render: (r) => r.contact },
    {
      key: 'debit',
      label: 'Debit',
      align: 'right',
      render: (r) => formatMoney(r.debit),
      csv: (r) => r.debit,
    },
    {
      key: 'credit',
      label: 'Credit',
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
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {yearControl}
        <Field label="Student status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="running">Running</option>
            <option value="left">Left</option>
            <option value="graduated">Graduated</option>
          </Select>
        </Field>
        <div className="sm:col-span-2 lg:col-span-1">
          <ClassPicker classId={classId} onChange={(id) => setClassId(id)} allowAnyClass yearId={yearId} />
        </div>
        <Field label="Balance at least">
          <Input
            value={balanceGt}
            onChange={(e) => setBalanceGt(e.target.value)}
            placeholder="e.g. 5000"
            inputMode="decimal"
          />
        </Field>
        <Field label="Balance at most">
          <Input
            value={balanceLt}
            onChange={(e) => setBalanceLt(e.target.value)}
            placeholder="e.g. 20000"
            inputMode="decimal"
          />
        </Field>
      </div>

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Students" value={summary.count} tone="accent" icon={<IconStudents size={16} />} />
          <StatCard label="Charged" value={`Rs. ${formatMoney(summary.debit)}`} />
          <StatCard label="Settled" value={`Rs. ${formatMoney(summary.credit)}`} tone="positive" />
          <StatCard label="Outstanding" value={`Rs. ${formatMoney(summary.balance)}`} tone="warning" />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Overall student ledgers</h2>
        <ReportActions title="student-ledgers" columns={columns} rows={rows} onPrint={() => window.print()} />
      </div>

      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="No matching students"
        emptyHint="Loosen the balance bounds or pick a different class."
        truncated={report.data?.truncated}
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.student_id} />
        <ReportPrintSheet
          title="Overall student ledgers"
          meta={summary ? `Academic year ${summary.academic_year} · ${summary.count} students` : undefined}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.student_id}
          totals={[{ label: 'Outstanding', value: `Rs. ${formatMoney(summary?.balance ?? 0)}` }]}
        />
      </ReportBody>
    </div>
  )
}
