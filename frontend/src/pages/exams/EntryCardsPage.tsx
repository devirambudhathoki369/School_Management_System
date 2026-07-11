import { useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useClasses } from '../../lib/billing'
import {
  useExamClassRoster,
  useExams,
  useSchedule,
  type ClassRosterRow,
  type ScheduleEntry,
} from '../../lib/exams'
import { formatMoney } from '../../lib/format'
import { PrintMirror } from '../billing/ReceiptSheet'
import { Button, EmptyState, Input, Select, SkeletonRows } from '../../components/ui'
import { IconIdCard, IconPrinter } from '../../components/icons'

/**
 * Exam entry cards (admit cards): one card per student with the exam's
 * schedule for their class. Schools traditionally withhold cards from fee
 * defaulters, so the roster can be filtered by outstanding dues before
 * printing — the legacy balance_gt/balance_lt search, kept client-side here
 * so the cut-off adjusts without refetching.
 */
export default function EntryCardsPage() {
  const exams = useExams()
  const [examId, setExamId] = useState('')
  const [classId, setClassId] = useState('')
  const [duesFilter, setDuesFilter] = useState(false)
  const [minDues, setMinDues] = useState('')
  const [maxDues, setMaxDues] = useState('')

  const exam = (exams.data ?? []).find((e) => e.id === examId) ?? null
  const classes = useClasses(exam ? [exam.academic_year] : [])
  const roster = useExamClassRoster(classId || null, true)
  const schedule = useSchedule(examId || null)

  const classLabel = (classes.data ?? []).find((c) => c.id === classId)?.label ?? ''
  const classSchedule = useMemo(
    () =>
      (schedule.data ?? [])
        .filter((entry) => entry.class_info === classId)
        .sort((a, b) => a.exam_date_bs.localeCompare(b.exam_date_bs)),
    [schedule.data, classId],
  )

  const students = useMemo(() => {
    let rows = roster.data ?? []
    if (duesFilter) {
      const min = minDues.trim() === '' ? null : Number(minDues)
      const max = maxDues.trim() === '' ? null : Number(maxDues)
      rows = rows.filter((row) => {
        const dues = Number(row.dues ?? 0)
        if (min != null && !Number.isNaN(min) && dues <= min) return false
        if (max != null && !Number.isNaN(max) && dues >= max) return false
        return true
      })
    }
    return rows
  }, [roster.data, duesFilter, minDues, maxDues])

  const ready = examId && classId

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={examId}
          onChange={(e) => {
            setExamId(e.target.value)
            setClassId('')
          }}
          aria-label="Exam"
          className="sm:w-64"
        >
          <option value="">{exams.isLoading ? 'Loading exams…' : 'Choose an exam…'}</option>
          {(exams.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        <Select
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          aria-label="Class"
          disabled={!examId}
          className="sm:w-64"
        >
          <option value="">Choose a class…</option>
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        {ready && students.length > 0 && (
          <div className="sm:ml-auto">
            <Button onClick={() => window.print()}>
              <IconPrinter size={16} /> Print {students.length} card
              {students.length === 1 ? '' : 's'}
            </Button>
          </div>
        )}
      </div>

      {ready && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={duesFilter}
              onChange={(e) => setDuesFilter(e.target.checked)}
              className="size-4 accent-accent"
            />
            Filter by outstanding dues
          </label>
          {duesFilter && (
            <>
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                more than
                <Input
                  value={minDues}
                  onChange={(e) => setMinDues(e.target.value)}
                  inputMode="numeric"
                  placeholder="0"
                  className="h-9 w-28 text-right"
                  aria-label="Dues more than"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-muted">
                less than
                <Input
                  value={maxDues}
                  onChange={(e) => setMaxDues(e.target.value)}
                  inputMode="numeric"
                  placeholder="any"
                  className="h-9 w-28 text-right"
                  aria-label="Dues less than"
                />
              </label>
              <span className="text-xs text-ink-faint">
                {students.length} of {roster.data?.length ?? 0} students match
              </span>
            </>
          )}
        </div>
      )}

      {!ready ? (
        <EmptyState
          icon={<IconIdCard size={22} />}
          title="Pick an exam and a class"
          hint="Entry cards print with each student's identity and the exam schedule."
        />
      ) : roster.isLoading || schedule.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={6} />
        </div>
      ) : students.length === 0 ? (
        <EmptyState
          icon={<IconIdCard size={22} />}
          title="No students to print"
          hint={duesFilter ? 'Loosen the dues filter.' : 'This class has no running students.'}
        />
      ) : (
        <>
          {classSchedule.length === 0 && (
            <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink">
              No exam schedule exists for this class yet — cards will print without a
              routine table.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {students.map((student) => (
              <div key={student.id} className="rounded-xl border border-border bg-surface p-4">
                <EntryCard
                  student={student}
                  examName={exam?.name ?? ''}
                  classLabel={classLabel}
                  schedule={classSchedule}
                />
              </div>
            ))}
          </div>
          <PrintMirror>
            <div className="bg-white p-6 text-black">
              {students.map((student) => (
                <div
                  key={student.id}
                  className="mb-6 break-inside-avoid rounded-xl border border-black/60 p-4"
                >
                  <EntryCard
                    student={student}
                    examName={exam?.name ?? ''}
                    classLabel={classLabel}
                    schedule={classSchedule}
                    print
                  />
                </div>
              ))}
            </div>
          </PrintMirror>
        </>
      )}
    </div>
  )
}

function EntryCard({
  student,
  examName,
  classLabel,
  schedule,
  print = false,
}: {
  student: ClassRosterRow
  examName: string
  classLabel: string
  schedule: ScheduleEntry[]
  print?: boolean
}) {
  const { account } = useAuth()
  const school = account?.school
  const dues = Number(student.dues ?? 0)

  return (
    <div className={print ? 'text-black' : ''}>
      <header className="mb-2 text-center">
        <h2 className="text-sm font-bold uppercase tracking-wide">{school?.name}</h2>
        {school?.address && <p className="text-xs">{school.address}</p>}
        <p className="mt-1 text-[13px] font-semibold uppercase tracking-widest">
          Entry card — {examName}
        </p>
      </header>
      <dl className="mb-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[13px]">
        <Row label="Student" value={student.full_name} strong />
        <Row label="Class" value={classLabel} />
        <Row label="Roll no." value={student.roll_no || '—'} />
        <Row label="Symbol no." value={student.symbol_no || '—'} />
        <Row label="Regd no." value={student.regd_no || '—'} />
        {!print && student.dues !== undefined && (
          <Row
            label="Dues"
            value={dues > 0 ? formatMoney(student.dues!) : 'Clear'}
          />
        )}
      </dl>
      {schedule.length > 0 && (
        <table className="w-full border-collapse text-xs [&_td]:border [&_th]:border [&_td]:border-current/40 [&_th]:border-current/40 [&_td]:px-1.5 [&_td]:py-1 [&_th]:px-1.5 [&_th]:py-1">
          <thead>
            <tr className="text-left">
              <th>Subject</th>
              <th>Date (BS)</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.subject_name}</td>
                <td className="tabular-nums">{entry.exam_date_bs}</td>
                <td className="tabular-nums">
                  {entry.start_time
                    ? `${entry.start_time}${entry.end_time ? ` – ${entry.end_time}` : ''}`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <footer className="mt-4 flex items-end justify-between text-[11px]">
        <span className="border-t border-current px-3 pt-0.5">Student</span>
        <span className="border-t border-current px-3 pt-0.5">Exam coordinator</span>
      </footer>
    </div>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-ink-muted print:text-current">{label}:</dt>
      <dd className={`min-w-0 truncate capitalize ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  )
}
