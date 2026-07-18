import { Fragment, useState } from 'react'
import { useAuth, type PrintDesign } from '../../lib/auth'
import { useAcademicYearsFull, useClassesOfYear } from '../../lib/academics'
import { useFinalClassResult, type FinalClassResult } from '../../lib/exams'
import { MARKSHEET_DESIGNS } from './marksheets'
import { PrintMirror } from '../billing/ReceiptSheet'
import { ClassResultTable, PrintFrame } from './ResultsPage'
import { Badge, Button, EmptyState, Select, SkeletonRows } from '../../components/ui'
import { IconClipboard, IconPrinter, IconX } from '../../components/icons'
import { apiErrorMessage } from '../../components/ui'

/**
 * Final (annual) results — the aggregate over every exam of the year that
 * carries an inclusion weight (First Term 25 + Second Term 25 + Annual 50).
 * Same contract as a single exam, so the ranked grid and all marksheet
 * designs render unchanged; the combined view adds per-exam columns.
 */
export default function FinalResultsPage() {
  const { account } = useAuth()
  const years = useAcademicYearsFull()
  const [yearId, setYearId] = useState('')
  const [classId, setClassId] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  const [combined, setCombined] = useState(false)
  const [design, setDesign] = useState<PrintDesign>(
    account?.school?.print_design ?? 'classic',
  )

  const classes = useClassesOfYear(yearId || null)
  const result = useFinalClassResult(yearId || null, classId || null)
  const data = result.data
  const student = data?.students.find((s) => s.id === studentId) ?? null
  const Marksheet = MARKSHEET_DESIGNS[design].Component

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={yearId}
          onChange={(e) => {
            setYearId(e.target.value)
            setClassId('')
            setStudentId(null)
          }}
          aria-label="Academic year"
          className="sm:w-56"
        >
          <option value="">{years.isLoading ? 'Loading years…' : 'Choose a year…'}</option>
          {(years.data ?? []).map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
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
          disabled={!yearId}
          className="sm:w-56"
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
            {!student && (
              <label className="flex items-center gap-1.5 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  checked={combined}
                  onChange={(e) => setCombined(e.target.checked)}
                  className="size-4 accent-accent"
                />
                Combined (per-exam columns)
              </label>
            )}
            {!data.published && <Badge tone="warning">includes unpublished sheets</Badge>}
            <Button variant="secondary" onClick={() => window.print()}>
              <IconPrinter size={16} /> Print {student ? 'final marksheet' : 'final result'}
            </Button>
          </div>
        )}
      </div>

      {data && (
        <p className="mb-3 text-xs text-ink-muted">
          Weighted from:{' '}
          {data.included_exams.map((e) => `${e.name} (${Number(e.weight)}%)`).join(' + ')}
        </p>
      )}

      {!yearId || !classId ? (
        <EmptyState
          icon={<IconClipboard size={22} />}
          title="Pick a year and a class"
          hint="The final result aggregates every exam that carries an inclusion weight."
        />
      ) : result.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={8} />
        </div>
      ) : result.isError ? (
        <EmptyState
          icon={<IconClipboard size={22} />}
          title="Final result unavailable"
          hint={apiErrorMessage(result.error)}
        />
      ) : !data || data.students.length === 0 ? (
        <EmptyState
          icon={<IconClipboard size={22} />}
          title="No marks entered"
          hint="Enter marks on the weighted exams' result sheets first."
        />
      ) : student ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStudentId(null)}
              className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink"
            >
              <IconX size={14} /> Back to final result
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
      ) : combined ? (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <CombinedResultTable data={data} onStudent={setStudentId} />
          </div>
          <PrintMirror>
            <PrintFrame>
              <CombinedResultTable data={data} />
            </PrintFrame>
          </PrintMirror>
        </>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <ClassResultTable data={data} onStudent={setStudentId} />
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            Tap a student for their printable final marksheet.
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

function num(value: string | null | undefined): string {
  if (value == null) return '—'
  const n = Number(value)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** The combined marksheet grid: each subject expands to one column per
 *  weighted exam plus the final — the legacy "Marksheet (Combined)" view. */
function CombinedResultTable({
  data,
  onStudent,
}: {
  data: FinalClassResult
  onStudent?: (id: string) => void
}) {
  const exams = data.included_exams
  return (
    <div>
      <div className="px-4 pb-1 pt-3 text-center">
        <p className="text-sm font-semibold">
          {data.exam.name} (combined) — {data.class_label}
        </p>
      </div>
      <table className="w-full min-w-[860px] text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th rowSpan={2} className="px-3 py-2 text-left font-medium">Rank</th>
            <th rowSpan={2} className="px-3 py-2 text-left font-medium">Student</th>
            {data.subjects.map((s) => (
              <th
                key={s.id}
                colSpan={exams.length + 1}
                className="border-l border-border px-2 py-1.5 text-center font-medium"
              >
                {s.name}
              </th>
            ))}
            <th rowSpan={2} className="border-l border-border px-2 py-2 text-right font-medium">
              Total
            </th>
            <th rowSpan={2} className="px-2 py-2 text-right font-medium">GPA</th>
          </tr>
          <tr>
            {data.subjects.map((s) => (
              <Fragment key={s.id}>
                {exams.map((e) => (
                  <th
                    key={`${s.id}-${e.id}`}
                    className="border-l border-border px-2 py-1.5 text-right font-normal normal-case"
                  >
                    {e.name}
                  </th>
                ))}
                <th key={`${s.id}-final`} className="px-2 py-1.5 text-right font-medium">
                  Final
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.students.map((row) => (
            <tr
              key={row.id}
              className={`border-b border-border/60 last:border-0 ${
                onStudent ? 'cursor-pointer hover:bg-surface-muted' : ''
              }`}
              onClick={onStudent ? () => onStudent(row.id) : undefined}
            >
              <td className="px-3 py-2">{row.position_in_class ?? '—'}</td>
              <td className="px-3 py-2 font-medium">{row.name}</td>
              {data.subjects.map((s) => {
                const mark = row.marks[s.id]
                return (
                  <Fragment key={`${row.id}-${s.id}`}>
                    {exams.map((e) => (
                      <td
                        key={`${row.id}-${s.id}-${e.id}`}
                        className="border-l border-border/40 px-2 py-2 text-right tabular-nums text-ink-muted"
                      >
                        {num(mark?.breakdown?.[e.id])}
                      </td>
                    ))}
                    <td
                      key={`${row.id}-${s.id}-final`}
                      className={`px-2 py-2 text-right font-medium tabular-nums ${
                        mark && !mark.passed ? 'text-danger' : ''
                      }`}
                    >
                      {mark ? num(mark.total) : '—'}
                    </td>
                  </Fragment>
                )
              })}
              <td className="border-l border-border/40 px-2 py-2 text-right font-semibold tabular-nums">
                {num(row.total)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{row.gpa ? num(row.gpa) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
