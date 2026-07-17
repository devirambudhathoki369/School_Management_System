import { useEffect, useState } from 'react'
import ClassPicker from '../../components/ClassPicker'
import { Field, Input, StatCard } from '../../components/ui'
import { IconCalendar } from '../../components/icons'
import { useCalendar } from '../../lib/billing'
import {
  useAttendanceSummaryReport,
  type AttendanceClassRow,
  type AttendanceSchoolRow,
} from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  type Col,
} from './shared'

/**
 * Attendance report over a BS range: per-student for one class, or the
 * whole school classwise. Defaults to the current BS month so the page
 * lands with data, not an empty form.
 */

const SCOPES = [
  { id: 'class', label: 'One class' },
  { id: 'school', label: 'Whole school' },
] as const

export default function AttendanceReportPage() {
  const calendar = useCalendar()
  const [scope, setScope] = useState<'class' | 'school'>('class')
  const [classId, setClassId] = useState('')
  const [fromBs, setFromBs] = useState('')
  const [toBs, setToBs] = useState('')

  useEffect(() => {
    if (!fromBs && calendar.data) {
      const today = calendar.data.today_bs
      setFromBs(`${today.slice(0, 8)}01`)
      setToBs(today)
    }
  }, [fromBs, calendar.data])

  const enabled = !!fromBs && !!toBs && (scope === 'school' || !!classId)
  const report = useAttendanceSummaryReport(
    {
      scope,
      class_info: scope === 'class' ? classId : undefined,
      from_bs: fromBs,
      to_bs: toBs,
    },
    enabled,
  )
  const rows = report.data?.rows ?? []
  const summary = report.data?.summary

  const classColumns: Array<Col<AttendanceClassRow>> = [
    { key: 'roll', label: 'Roll', render: (r) => r.roll_no },
    { key: 'name', label: 'Student', render: (r) => r.name },
    { key: 'marked', label: 'Days marked', align: 'right', render: (r) => r.marked },
    { key: 'present', label: 'Present', align: 'right', render: (r) => r.present },
    { key: 'absent', label: 'Absent', align: 'right', render: (r) => r.absent },
    {
      key: 'rate',
      label: 'Rate',
      align: 'right',
      render: (r) => (r.rate != null ? `${r.rate}%` : '—'),
      csv: (r) => r.rate ?? '',
    },
  ]
  const schoolColumns: Array<Col<AttendanceSchoolRow>> = [
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    { key: 'days', label: 'Days marked', align: 'right', render: (r) => r.days_marked },
    { key: 'marked', label: 'Marks', align: 'right', render: (r) => r.marked },
    { key: 'present', label: 'Present', align: 'right', render: (r) => r.present },
    { key: 'absent', label: 'Absent', align: 'right', render: (r) => r.absent },
  ]

  return (
    <div>
      <div className="mb-4 flex w-max gap-1 rounded-xl bg-surface-sunken p-1">
        {SCOPES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScope(s.id)}
            aria-pressed={scope === s.id}
            className={`flex h-9 items-center rounded-lg px-3.5 text-sm font-medium transition-colors ${
              scope === s.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scope === 'class' && (
          <div className="sm:col-span-2">
            <ClassPicker classId={classId} onChange={(id) => setClassId(id)} />
          </div>
        )}
        <Field label="From (BS)">
          <Input value={fromBs} onChange={(e) => setFromBs(e.target.value)} placeholder="2082-04-01" />
        </Field>
        <Field label="To (BS)">
          <Input value={toBs} onChange={(e) => setToBs(e.target.value)} placeholder="2082-04-30" />
        </Field>
      </div>

      {summary && scope === 'class' && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-md">
          <StatCard label="Students" value={String(summary.students ?? '—')} tone="accent" icon={<IconCalendar size={16} />} />
          <StatCard label="Days marked" value={String(summary.days_marked ?? '—')} />
        </div>
      )}
      {summary && scope === 'school' && (
        <div className="mb-4 grid grid-cols-3 gap-3 lg:max-w-lg">
          <StatCard label="Classes" value={String(summary.classes ?? '—')} tone="accent" icon={<IconCalendar size={16} />} />
          <StatCard label="Present" value={String(summary.present ?? '—')} tone="positive" />
          <StatCard label="Absent" value={String(summary.absent ?? '—')} tone="warning" />
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Attendance report</h2>
        {scope === 'class' ? (
          <ReportActions
            title="attendance-report"
            columns={classColumns}
            rows={rows as AttendanceClassRow[]}
            onPrint={() => window.print()}
          />
        ) : (
          <ReportActions
            title="attendance-overall"
            columns={schoolColumns}
            rows={rows as AttendanceSchoolRow[]}
            onPrint={() => window.print()}
          />
        )}
      </div>

      <ReportBody
        loading={report.isLoading || !enabled}
        empty={rows.length === 0}
        emptyTitle="No attendance in range"
        emptyHint="No registers were marked between these dates."
      >
        {scope === 'class' ? (
          <>
            <ReportTable
              columns={classColumns}
              rows={rows as AttendanceClassRow[]}
              rowKey={(r) => r.student_id}
            />
            <ReportPrintSheet
              title="Student attendance report"
              meta={`${String(summary?.class_label ?? '')} · ${fromBs} to ${toBs}`}
              columns={classColumns}
              rows={rows as AttendanceClassRow[]}
              rowKey={(r) => r.student_id}
            />
          </>
        ) : (
          <>
            <ReportTable
              columns={schoolColumns}
              rows={rows as AttendanceSchoolRow[]}
              rowKey={(r) => r.class_info}
            />
            <ReportPrintSheet
              title="Attendance overall report"
              meta={`${fromBs} to ${toBs}`}
              columns={schoolColumns}
              rows={rows as AttendanceSchoolRow[]}
              rowKey={(r) => r.class_info}
            />
          </>
        )}
      </ReportBody>
    </div>
  )
}
