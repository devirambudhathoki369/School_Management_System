import { useState } from 'react'
import ClassPicker from '../../components/ClassPicker'
import { Badge, Field, Select, StatCard } from '../../components/ui'
import { IconUserPlus } from '../../components/icons'
import { formatDateBS } from '../../lib/format'
import { useAdmissionsReport, type AdmissionRow } from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  useYearFilter,
  type Col,
} from './shared'

/**
 * Admissions & enrollments: with a year it is the "new admissions" sheet
 * (students admitted in that year); the class filter narrows to one class;
 * ordering is newest-first so it doubles as the recent-enrollments feed.
 */

export default function AdmissionsReportPage() {
  const [yearId, , yearControl] = useYearFilter()
  const [classId, setClassId] = useState('')
  const [status, setStatus] = useState('')

  const report = useAdmissionsReport({
    academic_year: yearId || undefined,
    class_info: classId || undefined,
    status: status || undefined,
  })
  const rows = report.data?.rows ?? []
  const summary = report.data?.summary

  const columns: Array<Col<AdmissionRow>> = [
    { key: 'name', label: 'Student', render: (r) => r.name },
    { key: 'gender', label: 'Gender', render: (r) => r.gender },
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    { key: 'roll', label: 'Roll', render: (r) => r.roll_no },
    { key: 'dob', label: 'Birth date (BS)', render: (r) => formatDateBS(r.birth_date_bs), csv: (r) => r.birth_date_bs },
    { key: 'guardian', label: 'Guardian', render: (r) => r.guardian_name },
    { key: 'contact', label: 'Contact', render: (r) => r.contact || r.guardian_contact },
    { key: 'address', label: 'Address', render: (r) => r.address },
    {
      key: 'status',
      label: 'Status',
      render: (r) =>
        r.status === 'running' ? (
          <Badge tone="positive">running</Badge>
        ) : (
          <Badge tone="neutral">{r.status}</Badge>
        ),
      csv: (r) => r.status,
    },
    { key: 'enrolled', label: 'Enrolled (AD)', render: (r) => r.enrolled_at },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {yearControl}
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="running">Running</option>
            <option value="left">Left</option>
            <option value="graduated">Graduated</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <ClassPicker classId={classId} onChange={(id) => setClassId(id)} allowAnyClass yearId={yearId} />
        </div>
      </div>

      {summary && (
        <div className="mb-4 grid grid-cols-3 gap-3 lg:max-w-lg">
          <StatCard label="Admissions" value={summary.count} tone="accent" icon={<IconUserPlus size={16} />} />
          <StatCard label="Male" value={summary.male} />
          <StatCard label="Female" value={summary.female} />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">New admissions</h2>
        <ReportActions title="new-admissions" columns={columns} rows={rows} onPrint={() => window.print()} />
      </div>

      <ReportBody
        loading={report.isLoading}
        empty={rows.length === 0}
        emptyTitle="No admissions"
        emptyHint="No students were admitted under the selected year and filters."
        truncated={report.data?.truncated}
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        <ReportPrintSheet
          title="New admissions report"
          meta={summary?.academic_year ? `Academic year ${summary.academic_year} · ${summary.count} students` : undefined}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
        />
      </ReportBody>
    </div>
  )
}
