import { useState } from 'react'
import { useAuth, type PrintDesign } from '../../lib/auth'
import { useClasses } from '../../lib/billing'
import {
  useClassResult,
  useExams,
  type ClassResult,
} from '../../lib/exams'
import { MARKSHEET_DESIGNS } from './marksheets'
import { PrintMirror } from '../billing/ReceiptSheet'
import { Badge, Button, EmptyState, Select, SkeletonRows } from '../../components/ui'
import { IconClipboard, IconPrinter, IconX } from '../../components/icons'

/**
 * Printable results (legacy class result + marksheet): the whole class in
 * one ranked grid, and a per-student marksheet with letters and GPA. Both
 * print through #print-root — Ctrl/Cmd+P emits just the sheet.
 */
export default function ResultsPage() {
  const { account } = useAuth()
  const exams = useExams()
  const [examId, setExamId] = useState('')
  const [classId, setClassId] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  // The school's house style opens by default; any design is one click away.
  const [design, setDesign] = useState<PrintDesign>(
    account?.school?.print_design ?? 'classic',
  )

  const exam = (exams.data ?? []).find((e) => e.id === examId) ?? null
  const classes = useClasses(exam ? [exam.academic_year] : [])
  const result = useClassResult(examId || null, classId || null)
  const data = result.data
  const student = data?.students.find((s) => s.id === studentId) ?? null
  const Marksheet = MARKSHEET_DESIGNS[design].Component

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={examId}
          onChange={(e) => {
            setExamId(e.target.value)
            setClassId('')
            setStudentId(null)
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
          onChange={(e) => {
            setClassId(e.target.value)
            setStudentId(null)
          }}
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
        {data && data.students.length > 0 && (
          <div className="flex items-center gap-2 sm:ml-auto">
            {!data.published && <Badge tone="warning">unpublished — draft</Badge>}
            <Button variant="secondary" onClick={() => window.print()}>
              <IconPrinter size={16} /> Print {student ? 'marksheet' : 'class result'}
            </Button>
          </div>
        )}
      </div>

      {!examId || !classId ? (
        <EmptyState
          icon={<IconClipboard size={22} />}
          title="Pick an exam and a class"
          hint="The full class result loads with per-student marksheets."
        />
      ) : result.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={8} />
        </div>
      ) : !data || data.students.length === 0 ? (
        <EmptyState
          icon={<IconClipboard size={22} />}
          title="No marks entered"
          hint="Enter marks on the result sheets first."
        />
      ) : student ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStudentId(null)}
              className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
            >
              <IconX size={14} /> Back to class result
            </button>
            <div
              role="radiogroup"
              aria-label="Marksheet design"
              className="ml-auto flex gap-1 rounded-lg bg-surface-sunken p-1"
            >
              {(Object.keys(MARKSHEET_DESIGNS) as PrintDesign[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={design === key}
                  onClick={() => setDesign(key)}
                  className={`h-8 rounded-md px-3 text-xs font-medium transition-colors ${
                    design === key
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {MARKSHEET_DESIGNS[key].label}
                  {key === (account?.school?.print_design ?? 'classic') && (
                    <span className="ml-1 text-ink-faint">·</span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div
            key={design}
            className="mx-auto max-w-2xl animate-scale-in overflow-hidden rounded-xl border border-border bg-white shadow-sm"
          >
            <Marksheet data={data} student={student} school={account?.school ?? null} />
          </div>
          <PrintMirror>
            <Marksheet data={data} student={student} school={account?.school ?? null} />
          </PrintMirror>
        </>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <ClassResultTable data={data} onStudent={setStudentId} />
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Tap a student for their printable marksheet.
          </p>
          <PrintMirror>
            <PrintFrame>
              <ClassResultTable data={data} />
            </PrintFrame>
          </PrintMirror>
        </>
      )}
    </div>
  )
}

/** Letterhead wrapper for anything printed from this page. */
function PrintFrame({ children }: { children: React.ReactNode }) {
  const { account } = useAuth()
  const school = account?.school
  return (
    <div className="bg-white p-8 text-sm text-black">
      <header className="mb-4 text-center">
        <h1 className="text-lg font-bold uppercase tracking-wide">{school?.name}</h1>
        {school?.address && <p>{school.address}</p>}
        {school?.contact && <p className="text-xs">Tel: {school.contact}</p>}
      </header>
      {children}
      <footer className="mt-8 flex items-end justify-between text-xs">
        <p>Printed from School ERP</p>
        <p className="border-t border-black px-6 pt-1">Authorised signature</p>
      </footer>
    </div>
  )
}

function num(value: string | null): string {
  if (value == null) return '—'
  const n = Number(value)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function ClassResultTable({
  data,
  onStudent,
}: {
  data: ClassResult
  onStudent?: (id: string) => void
}) {
  return (
    <div>
      <div className="px-4 pb-1 pt-3 text-center">
        <p className="text-sm font-semibold">
          {data.exam.name} — {data.class_label} ({data.exam.academic_year_name})
        </p>
      </div>
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Rank</th>
            <th className="px-3 py-2 text-left font-medium">Roll</th>
            <th className="px-3 py-2 text-left font-medium">Student</th>
            {data.subjects.map((s) => (
              <th key={s.id} className="px-2 py-2 text-right font-medium">
                {s.name}
                <span className="block font-normal normal-case text-ink-faint">
                  FM {num(s.full_marks)}
                </span>
              </th>
            ))}
            <th className="px-2 py-2 text-right font-medium">Total</th>
            <th className="px-2 py-2 text-right font-medium">%</th>
            <th className="px-2 py-2 text-right font-medium">GPA</th>
            <th className="px-3 py-2 text-right font-medium">Result</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.students.map((row, index) => (
            <tr
              key={row.id}
              onClick={onStudent ? () => onStudent(row.id) : undefined}
              className={onStudent ? 'cursor-pointer hover:bg-surface-muted' : ''}
            >
              <td className="px-3 py-2 tabular-nums">
                {row.position_in_section ?? index + 1}
              </td>
              <td className="px-3 py-2 tabular-nums">{row.roll_no || '—'}</td>
              <td className="px-3 py-2 font-medium">{row.name}</td>
              {data.subjects.map((s) => {
                const mark = row.marks[s.id]
                return (
                  <td key={s.id} className="px-2 py-2 text-right tabular-nums">
                    {mark ? (mark.absent ? 'Ab' : num(mark.total)) : '—'}
                  </td>
                )
              })}
              <td className="px-2 py-2 text-right font-semibold tabular-nums">
                {num(row.total)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{num(row.percentage)}</td>
              <td className="px-2 py-2 text-right tabular-nums">
                {row.gpa ? `${num(row.gpa)}` : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                {row.all_passed ? 'Pass' : 'Fail'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
