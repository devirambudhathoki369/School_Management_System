import { Badge, StatCard } from '../../components/ui'
import { IconStudents } from '../../components/icons'
import { useAuth } from '../../lib/auth'
import { formatDateBS } from '../../lib/format'
import {
  useBirthdaysReport,
  useClassStatisticsReport,
  type BirthdayRow,
  type ClassStatRow,
} from '../../lib/reports'
import {
  ReportActions,
  ReportBody,
  ReportPrintSheet,
  ReportTable,
  type Col,
} from './shared'

/**
 * Demographics: the classwise gender census plus this month's birthdays —
 * the legacy dashboard widgets as printable sheets.
 */

export default function DemographicsPage() {
  const { account } = useAuth()
  const isAdmin = account?.role === 'admin'
  const granted = new Set(account?.permissions ?? [])
  const canStaff = isAdmin || granted.has('staff.view') || granted.has('staff.manage')

  const stats = useClassStatisticsReport()
  const studentBirthdays = useBirthdaysReport('student')
  const staffBirthdays = useBirthdaysReport('staff', canStaff)

  const rows = stats.data?.rows ?? []
  const summary = stats.data?.summary

  const columns: Array<Col<ClassStatRow>> = [
    { key: 'class', label: 'Class', render: (r) => r.class_label },
    { key: 'male', label: 'Male', align: 'right', render: (r) => r.male },
    { key: 'female', label: 'Female', align: 'right', render: (r) => r.female },
    { key: 'other', label: 'Other', align: 'right', render: (r) => r.other },
    { key: 'total', label: 'Total', align: 'right', render: (r) => r.total },
  ]

  return (
    <div>
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Running students"
            value={String(summary.total ?? 0)}
            tone="accent"
            icon={<IconStudents size={16} />}
          />
          <StatCard label="Male" value={String(summary.male ?? 0)} />
          <StatCard label="Female" value={String(summary.female ?? 0)} />
          <StatCard label="Classes" value={String(summary.classes ?? 0)} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-muted">Classwise student statistics</h2>
            <ReportActions
              title="class-statistics"
              columns={columns}
              rows={rows}
              onPrint={() => window.print()}
            />
          </div>
          <ReportBody
            loading={stats.isLoading}
            empty={rows.length === 0}
            emptyTitle="No running students"
            emptyHint="Classes fill in as students are enrolled."
          >
            <ReportTable columns={columns} rows={rows} rowKey={(r) => r.class_info} />
            <ReportPrintSheet
              title="Classwise student statistics"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.class_info}
              totals={[{ label: 'Students', value: String(summary?.total ?? 0) }]}
            />
          </ReportBody>
        </section>

        <aside className="flex flex-col gap-4">
          <BirthdayCard
            title="Student birthdays this month"
            rows={studentBirthdays.data?.rows ?? []}
            loading={studentBirthdays.isLoading}
            detail={(r) => r.class_label ?? ''}
          />
          {canStaff && (
            <BirthdayCard
              title="Staff birthdays this month"
              rows={staffBirthdays.data?.rows ?? []}
              loading={staffBirthdays.isLoading}
              detail={(r) => r.role ?? ''}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

function BirthdayCard({
  title,
  rows,
  loading,
  detail,
}: {
  title: string
  rows: BirthdayRow[]
  loading: boolean
  detail: (row: BirthdayRow) => string
}) {
  return (
    <div className="lift rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink-muted">{title}</h3>
      {loading ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-faint">No birthdays left this month.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="truncate text-xs text-ink-faint">{detail(r)}</p>
              </div>
              {r.is_today ? (
                <Badge tone="accent">today 🎂</Badge>
              ) : (
                <span className="whitespace-nowrap text-xs tabular-nums text-ink-muted">
                  {formatDateBS(r.birth_date_bs).slice(0, -5) || r.birth_date_bs.slice(5)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
