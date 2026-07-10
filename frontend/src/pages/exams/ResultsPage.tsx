import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import { useClasses } from '../../lib/billing'
import {
  useClassResult,
  useExams,
  type ClassResult,
  type ClassResultStudent,
} from '../../lib/exams'
import { PrintMirror } from '../billing/ReceiptSheet'
import { Badge, Button, EmptyState, Select, SkeletonRows } from '../../components/ui'
import { IconClipboard, IconPrinter, IconX } from '../../components/icons'

/**
 * Printable results (legacy class result + marksheet): the whole class in
 * one ranked grid, and a per-student marksheet with letters and GPA. Both
 * print through #print-root — Ctrl/Cmd+P emits just the sheet.
 */
export default function ResultsPage() {
  const exams = useExams()
  const [examId, setExamId] = useState('')
  const [classId, setClassId] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)

  const exam = (exams.data ?? []).find((e) => e.id === examId) ?? null
  const classes = useClasses(exam ? [exam.academic_year] : [])
  const result = useClassResult(examId || null, classId || null)
  const data = result.data
  const student = data?.students.find((s) => s.id === studentId) ?? null

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
          <button
            onClick={() => setStudentId(null)}
            className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
          >
            <IconX size={14} /> Back to class result
          </button>
          <div className="mx-auto max-w-2xl rounded-xl border border-border bg-surface p-6">
            <Marksheet data={data} student={student} />
          </div>
          <PrintMirror>
            <PrintFrame>
              <Marksheet data={data} student={student} />
            </PrintFrame>
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

function Marksheet({ data, student }: { data: ClassResult; student: ClassResultStudent }) {
  return (
    <div>
      <div className="mb-4 text-center">
        <p className="text-base font-semibold">{data.exam.name} — Marksheet</p>
        <p className="text-sm text-ink-muted">
          {data.class_label} · {data.exam.academic_year_name}
        </p>
      </div>
      <div className="mb-4 flex flex-wrap justify-between gap-2 text-sm">
        <p>
          <span className="text-ink-muted">Student:</span>{' '}
          <span className="font-semibold">{student.name}</span>
        </p>
        <p>
          <span className="text-ink-muted">Roll:</span>{' '}
          <span className="font-semibold">{student.roll_no || '—'}</span>
        </p>
        {student.position_in_section != null && (
          <p>
            <span className="text-ink-muted">Rank:</span>{' '}
            <span className="font-semibold">{student.position_in_section}</span>
          </p>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="border-b-2 border-current text-xs uppercase tracking-wide">
          <tr>
            <th className="py-1.5 pr-2 text-left font-medium">Subject</th>
            <th className="px-2 py-1.5 text-right font-medium">FM</th>
            <th className="px-2 py-1.5 text-right font-medium">Theory</th>
            <th className="px-2 py-1.5 text-right font-medium">Practical</th>
            <th className="px-2 py-1.5 text-right font-medium">Total</th>
            <th className="px-2 py-1.5 text-right font-medium">Grade</th>
            <th className="py-1.5 pl-2 text-right font-medium">GP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.subjects.map((subject) => {
            const mark = student.marks[subject.id]
            return (
              <tr key={subject.id}>
                <td className="py-2 pr-2">{subject.name}</td>
                <td className="px-2 py-2 text-right tabular-nums">{num(subject.full_marks)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {mark ? num(mark.theory) : '—'}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {mark ? num(mark.practical) : '—'}
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">
                  {mark ? (mark.absent ? 'Ab' : num(mark.total)) : '—'}
                </td>
                <td className="px-2 py-2 text-right">{mark?.letter || '—'}</td>
                <td className="py-2 pl-2 text-right tabular-nums">
                  {mark ? num(mark.grade_point) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="border-t-2 border-current font-semibold">
          <tr>
            <td className="py-2 pr-2">Total</td>
            <td className="px-2 py-2 text-right tabular-nums">{num(student.full_marks)}</td>
            <td colSpan={2} />
            <td className="px-2 py-2 text-right tabular-nums">{num(student.total)}</td>
            <td className="px-2 py-2 text-right">{student.gpa_letter || '—'}</td>
            <td className="py-2 pl-2 text-right tabular-nums">
              {student.gpa ? num(student.gpa) : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
        <p>
          <span className="text-ink-muted">Percentage:</span>{' '}
          <span className="font-semibold">{num(student.percentage)}%</span>
        </p>
        <p>
          <span className="text-ink-muted">GPA:</span>{' '}
          <span className="font-semibold">
            {student.gpa ? `${num(student.gpa)} (${student.gpa_letter})` : '—'}
          </span>
        </p>
        <p>
          <span className="text-ink-muted">Result:</span>{' '}
          <span className="font-semibold">{student.all_passed ? 'Passed' : 'Failed'}</span>
        </p>
      </div>
    </div>
  )
}
