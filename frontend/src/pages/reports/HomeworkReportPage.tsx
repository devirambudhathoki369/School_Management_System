import { useEffect, useState } from 'react'
import { Badge, Field, Input, StatCard } from '../../components/ui'
import { IconNotebook } from '../../components/icons'
import { useCalendar } from '../../lib/billing'
import { formatDateBS } from '../../lib/format'
import { useHomeworkReport, type HomeworkRow } from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  type Col,
} from './shared'

/**
 * Homework report: everything assigned on one BS day — who set what for
 * which class, and when it is due. Withdrawn homework still lists (it was
 * given that day), flagged instead of hidden.
 */

export default function HomeworkReportPage() {
  const calendar = useCalendar()
  const [dateBs, setDateBs] = useState('')
  useEffect(() => {
    if (!dateBs && calendar.data) setDateBs(calendar.data.today_bs)
  }, [dateBs, calendar.data])

  const report = useHomeworkReport(dateBs)
  const rows = report.data?.rows ?? []

  const columns: Array<Col<HomeworkRow>> = [
    { key: 'teacher', label: 'Teacher', render: (r) => r.teacher },
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    { key: 'subject', label: 'Subject', render: (r) => r.subject },
    {
      key: 'title',
      label: 'Homework',
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          {r.title}
          {!r.is_active && <Badge tone="neutral">withdrawn</Badge>}
          {r.attachments > 0 && <Badge tone="accent">{r.attachments} file{r.attachments > 1 ? 's' : ''}</Badge>}
        </span>
      ),
      csv: (r) => r.title,
    },
    { key: 'due', label: 'Due (BS)', render: (r) => formatDateBS(r.due_date_bs), csv: (r) => r.due_date_bs },
  ]

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:max-w-xs">
        <Field label="Given on (BS)">
          <Input value={dateBs} onChange={(e) => setDateBs(e.target.value)} placeholder="2082-04-01" />
        </Field>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-xs">
        <StatCard
          label="Assignments"
          value={report.data?.summary.count ?? '—'}
          tone="accent"
          icon={<IconNotebook size={16} />}
        />
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-muted">Homework given</h2>
        <ReportActions title="homework-report" columns={columns} rows={rows} onPrint={() => window.print()} />
      </div>
      <ReportBody
        loading={report.isLoading || !dateBs}
        empty={rows.length === 0}
        emptyTitle="No homework that day"
        emptyHint="Pick another BS date — assignments list under the day they were given."
      >
        <ReportTable columns={columns} rows={rows} rowKey={(r) => r.id} />
        <ReportPrintSheet
          title="Homework report"
          meta={dateBs ? `Given on ${dateBs}` : undefined}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
        />
      </ReportBody>
    </div>
  )
}
