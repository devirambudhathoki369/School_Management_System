import { useState } from 'react'
import { Badge, Field, Select, StatCard } from '../../components/ui'
import { IconGraduate } from '../../components/icons'
import { formatDateBS } from '../../lib/format'
import { useStaffDetailsReport, type StaffDetailRow } from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  type Col,
} from './shared'

/** Staff details — the printable staff directory with employment facts. */

export default function StaffReportPage() {
  const [status, setStatus] = useState('employed')
  const report = useStaffDetailsReport(status)
  const rows = report.data?.rows ?? []

  const columns: Array<Col<StaffDetailRow>> = [
    { key: 'name', label: 'Name', render: (r) => r.name },
    { key: 'role', label: 'Role', render: (r) => r.role },
    { key: 'contact', label: 'Contact', render: (r) => r.primary_contact },
    { key: 'email', label: 'Email', render: (r) => r.email },
    { key: 'address', label: 'Address', render: (r) => r.address },
    { key: 'qualification', label: 'Qualification', render: (r) => r.qualification },
    { key: 'subject', label: 'Subjects', render: (r) => [r.primary_subject, r.secondary_subject].filter(Boolean).join(', ') },
    { key: 'joined', label: 'Joined (BS)', render: (r) => formatDateBS(r.joined_date_bs), csv: (r) => r.joined_date_bs },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        r.status === 'employed' ? <Badge tone="positive">employed</Badge> : <Badge tone="neutral">{r.status}</Badge>,
      csv: (r) => r.status,
    },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:max-w-xs">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="employed">Employed</option>
            <option value="resigned">Resigned</option>
            <option value="all">Everyone</option>
          </Select>
        </Field>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-xs">
        <StatCard
          label="Staff members"
          value={report.data?.summary.count ?? '—'}
          tone="accent"
          icon={<IconGraduate size={16} />}
        />
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Staff details</h2>
        <ReportActions title="staff-details" columns={columns} rows={rows} onPrint={() => window.print()} />
      </div>
      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="No staff records"
        emptyHint="Staff added under People → Staff appear in this report."
        truncated={report.data?.truncated}
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        <ReportPrintSheet title="Staff details" columns={columns} rows={rows} rowKey={(r) => r.id} />
      </ReportBody>
    </div>
  )
}
