import type { PrintDesign, SchoolInfo } from '../../lib/auth'
import type { ClassResult, ClassResultStudent } from '../../lib/exams'

/**
 * The marksheet design gallery. One school = one house style (picked by the
 * vendor at onboarding, default "classic"), but any design can be chosen at
 * print time for a one-off. Every design renders the same data contract, in
 * pure black-on-white so it prints identically on any printer:
 *
 * - classic  · the traditional bordered sheet schools have signed for decades
 * - elegant  · airy minimal — hairline rules, big name, GPA hero
 * - formal   · national-exam grid — full borders, boxed identity, legend
 * - compact  · dense half-page sheet for bulk printing
 */

export interface MarksheetProps {
  data: ClassResult
  student: ClassResultStudent
  school: Pick<SchoolInfo, 'name' | 'address' | 'contact'> | null
}

export const MARKSHEET_DESIGNS: Record<
  PrintDesign,
  { label: string; Component: (props: MarksheetProps) => React.ReactNode }
> = {
  classic: { label: 'Classic', Component: ClassicMarksheet },
  elegant: { label: 'Elegant', Component: ElegantMarksheet },
  formal: { label: 'Formal', Component: FormalMarksheet },
  compact: { label: 'Compact', Component: CompactMarksheet },
}

export function num(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—'
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'
  return `${n}${suffix}`
}

/* ------------------------------------------------------------- classic */

function ClassicMarksheet({ data, student, school }: MarksheetProps) {
  return (
    <div className="bg-white p-8 text-black">
      <header className="mb-4 text-center">
        <h1 className="text-xl font-bold uppercase tracking-wide">{school?.name}</h1>
        {school?.address && <p className="text-sm">{school.address}</p>}
        {school?.contact && <p className="text-xs">Tel: {school.contact}</p>}
        <p className="mx-auto mt-3 inline-block border-y-2 border-double border-black px-8 py-1 text-sm font-bold uppercase tracking-[0.2em]">
          Marksheet
        </p>
        <p className="mt-2 text-sm font-semibold">
          {data.exam.name} · {data.exam.academic_year_name}
        </p>
      </header>
      <div className="mb-4 flex flex-wrap justify-between gap-2 text-sm">
        <p>
          Student: <span className="font-bold uppercase">{student.name}</span>
        </p>
        <p>Class: <span className="font-semibold">{data.class_label}</span></p>
        <p>Roll: <span className="font-semibold">{student.roll_no || '—'}</span></p>
        {student.position_in_section != null && (
          <p>Rank: <span className="font-semibold">{ordinal(student.position_in_section)}</span></p>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="border-y-2 border-black text-xs uppercase tracking-wide">
          <tr>
            <th className="py-1.5 pr-2 text-left font-semibold">Subject</th>
            <th className="px-2 py-1.5 text-right font-semibold">Full marks</th>
            <th className="px-2 py-1.5 text-right font-semibold">Theory</th>
            <th className="px-2 py-1.5 text-right font-semibold">Practical</th>
            <th className="px-2 py-1.5 text-right font-semibold">Total</th>
            <th className="px-2 py-1.5 text-right font-semibold">Grade</th>
            <th className="py-1.5 pl-2 text-right font-semibold">GP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/25">
          {data.subjects.map((subject) => {
            const mark = student.marks[subject.id]
            return (
              <tr key={subject.id}>
                <td className="py-1.5 pr-2">{subject.name}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{num(subject.full_marks)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{mark ? num(mark.theory) : '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{mark ? num(mark.practical) : '—'}</td>
                <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                  {mark ? (mark.absent ? 'Ab' : num(mark.total)) : '—'}
                </td>
                <td className="px-2 py-1.5 text-right">{mark?.letter || '—'}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums">
                  {mark ? num(mark.grade_point) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot className="border-t-2 border-black font-semibold">
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
        <p>Percentage: <span className="font-bold">{num(student.percentage)}%</span></p>
        <p>
          GPA:{' '}
          <span className="font-bold">
            {student.gpa ? `${num(student.gpa)} (${student.gpa_letter})` : '—'}
          </span>
        </p>
        <p>Result: <span className="font-bold">{student.all_passed ? 'PASSED' : 'FAILED'}</span></p>
      </div>
      <footer className="mt-12 flex items-end justify-between text-xs">
        <span className="border-t border-black px-4 pt-1">Class teacher</span>
        <span className="border-t border-black px-4 pt-1">Exam coordinator</span>
        <span className="border-t border-black px-4 pt-1">Principal</span>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------- elegant */

function ElegantMarksheet({ data, student, school }: MarksheetProps) {
  return (
    <div className="bg-white p-10 text-black">
      <header className="mb-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-black/60">
          {school?.name}
        </p>
        {school?.address && (
          <p className="mt-0.5 text-[11px] tracking-wide text-black/50">{school.address}</p>
        )}
        <div className="mt-6 flex items-end justify-between gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-black/50">Marksheet</p>
            <h1 className="mt-1 text-3xl font-semibold capitalize leading-tight tracking-tight">
              {student.name.toLowerCase()}
            </h1>
            <p className="mt-1 text-sm text-black/60">
              {data.class_label} · Roll {student.roll_no || '—'} · {data.exam.name},{' '}
              {data.exam.academic_year_name}
            </p>
          </div>
          {student.gpa && (
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-[0.25em] text-black/50">GPA</p>
              <p className="text-4xl font-semibold tabular-nums leading-none tracking-tight">
                {num(student.gpa)}
              </p>
              <p className="mt-1 text-sm font-medium">{student.gpa_letter}</p>
            </div>
          )}
        </div>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/70 text-[11px] uppercase tracking-[0.15em] text-black/55">
            <th className="pb-2 pr-2 text-left font-medium">Subject</th>
            <th className="px-2 pb-2 text-right font-medium">FM</th>
            <th className="px-2 pb-2 text-right font-medium">Obtained</th>
            <th className="px-2 pb-2 text-right font-medium">Grade</th>
            <th className="pb-2 pl-2 text-right font-medium">GP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {data.subjects.map((subject) => {
            const mark = student.marks[subject.id]
            return (
              <tr key={subject.id}>
                <td className="py-2.5 pr-2">{subject.name}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-black/60">
                  {num(subject.full_marks)}
                </td>
                <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
                  {mark ? (mark.absent ? 'Ab' : num(mark.total)) : '—'}
                </td>
                <td className="px-2 py-2.5 text-right">{mark?.letter || '—'}</td>
                <td className="py-2.5 pl-2 text-right tabular-nums">
                  {mark ? num(mark.grade_point) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-6 flex justify-between border-t border-black/70 pt-3 text-sm">
        <p className="text-black/60">
          Total {num(student.total)} / {num(student.full_marks)} · {num(student.percentage)}%
          {student.position_in_section != null &&
            ` · ${ordinal(student.position_in_section)} in section`}
        </p>
        <p className="font-semibold uppercase tracking-wide">
          {student.all_passed ? 'Passed' : 'Failed'}
        </p>
      </div>
      <footer className="mt-16 flex items-end justify-between text-[11px] uppercase tracking-[0.15em] text-black/60">
        <span className="border-t border-black/50 px-6 pt-1.5">Class teacher</span>
        <span className="border-t border-black/50 px-6 pt-1.5">Principal</span>
      </footer>
    </div>
  )
}

/* -------------------------------------------------------------- formal */

function FormalMarksheet({ data, student, school }: MarksheetProps) {
  const cell = 'border border-black px-2 py-1.5'
  return (
    <div className="border-4 border-double border-black bg-white p-7 text-black">
      <header className="mb-4 text-center">
        <h1 className="text-xl font-bold uppercase tracking-wider">{school?.name}</h1>
        {school?.address && <p className="text-sm">{school.address}</p>}
        <p className="mt-2 text-base font-bold uppercase tracking-[0.25em]">
          Grade sheet
        </p>
        <p className="text-sm font-medium">
          {data.exam.name} — {data.exam.academic_year_name}
        </p>
      </header>
      <table className="mb-4 w-full border-collapse text-sm">
        <tbody>
          <tr>
            <td className={`${cell} w-1/2`}>
              <span className="text-[10px] uppercase tracking-wide">Name of student</span>
              <span className="block font-bold uppercase">{student.name}</span>
            </td>
            <td className={cell}>
              <span className="text-[10px] uppercase tracking-wide">Class</span>
              <span className="block font-semibold">{data.class_label}</span>
            </td>
            <td className={cell}>
              <span className="text-[10px] uppercase tracking-wide">Roll no.</span>
              <span className="block font-semibold tabular-nums">{student.roll_no || '—'}</span>
            </td>
            <td className={cell}>
              <span className="text-[10px] uppercase tracking-wide">Rank</span>
              <span className="block font-semibold tabular-nums">
                {student.position_in_section != null
                  ? ordinal(student.position_in_section)
                  : '—'}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-black/5 text-[11px] uppercase tracking-wide">
            <th className={`${cell} text-left`}>S.N</th>
            <th className={`${cell} text-left`}>Subject</th>
            <th className={`${cell} text-right`}>Full marks</th>
            <th className={`${cell} text-right`}>Theory</th>
            <th className={`${cell} text-right`}>Practical</th>
            <th className={`${cell} text-right`}>Total</th>
            <th className={`${cell} text-right`}>Grade</th>
            <th className={`${cell} text-right`}>Grade point</th>
          </tr>
        </thead>
        <tbody>
          {data.subjects.map((subject, index) => {
            const mark = student.marks[subject.id]
            return (
              <tr key={subject.id}>
                <td className={`${cell} tabular-nums`}>{index + 1}</td>
                <td className={cell}>{subject.name}</td>
                <td className={`${cell} text-right tabular-nums`}>{num(subject.full_marks)}</td>
                <td className={`${cell} text-right tabular-nums`}>
                  {mark ? num(mark.theory) : '—'}
                </td>
                <td className={`${cell} text-right tabular-nums`}>
                  {mark ? num(mark.practical) : '—'}
                </td>
                <td className={`${cell} text-right font-semibold tabular-nums`}>
                  {mark ? (mark.absent ? 'Ab' : num(mark.total)) : '—'}
                </td>
                <td className={`${cell} text-right`}>{mark?.letter || '—'}</td>
                <td className={`${cell} text-right tabular-nums`}>
                  {mark ? num(mark.grade_point) : '—'}
                </td>
              </tr>
            )
          })}
          <tr className="bg-black/5 font-bold">
            <td className={cell} colSpan={2}>Total</td>
            <td className={`${cell} text-right tabular-nums`}>{num(student.full_marks)}</td>
            <td className={cell} colSpan={2} />
            <td className={`${cell} text-right tabular-nums`}>{num(student.total)}</td>
            <td className={`${cell} text-right`}>{student.gpa_letter || '—'}</td>
            <td className={`${cell} text-right tabular-nums`}>
              {student.gpa ? num(student.gpa) : '—'}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-4 flex items-stretch justify-between gap-4 text-sm">
        <p className="flex-1 border border-black px-3 py-2 text-[11px] leading-relaxed">
          <span className="font-bold uppercase">Grading:</span> A+ (90–100) · A (80–90) ·
          B+ (70–80) · B (60–70) · C+ (50–60) · C (40–50) · D (35–40) · NG (below 35)
        </p>
        <div className="border-2 border-black px-4 py-2 text-center">
          <p className="text-[10px] uppercase tracking-wide">Final result</p>
          <p className="text-lg font-bold uppercase">
            {student.all_passed ? 'Passed' : 'Failed'}
          </p>
          <p className="text-xs tabular-nums">
            {student.gpa ? `GPA ${num(student.gpa)}` : `${num(student.percentage)}%`}
          </p>
        </div>
      </div>
      <footer className="mt-10 flex items-end justify-between text-xs">
        <span className="border-t border-black px-4 pt-1">Prepared by</span>
        <span className="border-t border-black px-4 pt-1">Checked by</span>
        <span className="border-t border-black px-4 pt-1">Principal</span>
      </footer>
    </div>
  )
}

/* ------------------------------------------------------------- compact */

function CompactMarksheet({ data, student, school }: MarksheetProps) {
  return (
    <div className="bg-white p-5 text-[13px] leading-snug text-black">
      <header className="mb-2 flex items-baseline justify-between gap-3 border-b-2 border-black pb-1.5">
        <div>
          <h1 className="text-sm font-bold uppercase tracking-wide">{school?.name}</h1>
          <p className="text-[11px]">
            Marksheet · {data.exam.name} · {data.exam.academic_year_name}
          </p>
        </div>
        <p className="text-right text-[11px]">
          <span className="font-bold uppercase">{student.name}</span>
          <br />
          {data.class_label} · Roll {student.roll_no || '—'}
          {student.position_in_section != null &&
            ` · ${ordinal(student.position_in_section)}`}
        </p>
      </header>
      <table className="w-full text-[12px]">
        <thead className="border-b border-black text-[10px] uppercase tracking-wide">
          <tr>
            <th className="py-0.5 pr-1 text-left font-semibold">Subject</th>
            <th className="px-1 py-0.5 text-right font-semibold">FM</th>
            <th className="px-1 py-0.5 text-right font-semibold">Th</th>
            <th className="px-1 py-0.5 text-right font-semibold">Pr</th>
            <th className="px-1 py-0.5 text-right font-semibold">Total</th>
            <th className="px-1 py-0.5 text-right font-semibold">Gr</th>
            <th className="py-0.5 pl-1 text-right font-semibold">GP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/15">
          {data.subjects.map((subject) => {
            const mark = student.marks[subject.id]
            return (
              <tr key={subject.id}>
                <td className="py-1 pr-1">{subject.name}</td>
                <td className="px-1 py-1 text-right tabular-nums">{num(subject.full_marks)}</td>
                <td className="px-1 py-1 text-right tabular-nums">
                  {mark ? num(mark.theory) : '—'}
                </td>
                <td className="px-1 py-1 text-right tabular-nums">
                  {mark ? num(mark.practical) : '—'}
                </td>
                <td className="px-1 py-1 text-right font-semibold tabular-nums">
                  {mark ? (mark.absent ? 'Ab' : num(mark.total)) : '—'}
                </td>
                <td className="px-1 py-1 text-right">{mark?.letter || '—'}</td>
                <td className="py-1 pl-1 text-right tabular-nums">
                  {mark ? num(mark.grade_point) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-1.5 flex justify-between border-t-2 border-black pt-1 text-[12px] font-semibold">
        <span>
          Total {num(student.total)}/{num(student.full_marks)} · {num(student.percentage)}%
        </span>
        <span>
          {student.gpa ? `GPA ${num(student.gpa)} (${student.gpa_letter})` : ''} ·{' '}
          {student.all_passed ? 'PASS' : 'FAIL'}
        </span>
      </div>
      <footer className="mt-6 flex items-end justify-between text-[10px]">
        <span className="border-t border-black px-3 pt-0.5">Class teacher</span>
        <span className="border-t border-black px-3 pt-0.5">Principal</span>
      </footer>
    </div>
  )
}
