import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { fetchAllPages, useCalendar } from '../../lib/billing'
import { useStudentLedgersReport } from '../../lib/reports'
import { useExams, useSheets, useExamClassRoster } from '../../lib/exams'
import ClassPicker from '../../components/ClassPicker'
import { PrintMirror } from '../billing/ReceiptSheet'
import { formatDateBS, formatMoney } from '../../lib/format'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonRows,
  apiErrorMessage,
} from '../../components/ui'
import { IconPrinter } from '../../components/icons'

/**
 * Print center — the legacy print-only leaves in one place: reminder bills,
 * student profile sheets, ID cards, blank marks-entry slips and letters to
 * students. Everything renders on the letterhead through #print-root, one
 * student per page where it matters.
 */

type Mode = 'reminders' | 'profiles' | 'idcards' | 'slips' | 'letters'

const MODES: Array<[Mode, string]> = [
  ['reminders', 'Reminder bills'],
  ['profiles', 'Profile prints'],
  ['idcards', 'ID cards'],
  ['slips', 'Marks slips'],
  ['letters', 'Letters'],
]

interface PrintStudentRow {
  id: string
  full_name: string
  gender: string
  roll_no: string
  class_label: string
  contact: string
  photo: string | null
}

function useClassStudents(classId: string | null) {
  return useQuery({
    queryKey: ['prints', 'students', classId],
    queryFn: () =>
      fetchAllPages<PrintStudentRow>('/api/v1/people/students/', {
        class_info: classId!,
        status: 'running',
      }),
    enabled: !!classId,
  })
}

export default function PrintCenterPage() {
  const [mode, setMode] = useState<Mode>('reminders')
  const [classId, setClassId] = useState('')

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="flex w-max gap-1 overflow-x-auto rounded-lg bg-surface-sunken p-1">
          {MODES.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              className={`h-9 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
                mode === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="lg:ml-auto lg:w-[420px]">
          <ClassPicker classId={classId} onChange={(id) => setClassId(id)} />
        </div>
      </div>

      {!classId ? (
        <EmptyState
          icon={<IconPrinter size={22} />}
          title="Pick a class"
          hint="Every print here runs class-at-once."
        />
      ) : mode === 'reminders' ? (
        <ReminderBills classId={classId} />
      ) : mode === 'profiles' ? (
        <ProfileSheets classId={classId} />
      ) : mode === 'idcards' ? (
        <IdCards classId={classId} />
      ) : mode === 'slips' ? (
        <MarksSlips classId={classId} />
      ) : (
        <Letters classId={classId} />
      )}
    </div>
  )
}

function Letterhead() {
  const { account } = useAuth()
  const school = account?.school
  return (
    <header className="mb-3 border-b-2 border-black pb-2 text-center">
      <h1 className="text-base font-bold uppercase tracking-wide">{school?.name}</h1>
      {school?.address && <p className="text-xs">{school.address}</p>}
      {school?.contact && <p className="text-[11px]">Tel: {school.contact}</p>}
    </header>
  )
}

function PrintButton({ disabled, label }: { disabled?: boolean; label: string }) {
  return (
    <div className="mb-3 flex justify-end">
      <Button variant="secondary" disabled={disabled} onClick={() => window.print()}>
        <IconPrinter size={16} /> Print {label}
      </Button>
    </div>
  )
}

// ------------------------------------------------------------- reminders

function ReminderBills({ classId }: { classId: string }) {
  const calendar = useCalendar()
  const [minDues, setMinDues] = useState('1')
  // any AY: ledgers need one; use the class's own year via the report's
  // academic_year requirement — the picker year isn't exposed here, so the
  // report is fetched per class with its year resolved server-side… the
  // endpoint requires academic_year, so resolve from the class list instead.
  const yearOfClass = useQuery({
    queryKey: ['prints', 'class-year', classId],
    queryFn: async () =>
      (await api.get<{ academic_year: string | null }>(`/api/v1/academics/classes/${classId}/`)).data
        .academic_year,
  })
  const ledgers = useStudentLedgersReport(
    { academic_year: yearOfClass.data ?? undefined, class_info: classId },
    !!yearOfClass.data,
  )
  const rows = (ledgers.data?.rows ?? []).filter(
    (r) => Number(r.balance) >= Number(minDues || '1'),
  )
  const today = calendar.data?.today_bs ?? ''

  const bills = (
    <div>
      {rows.map((r) => (
        <div
          key={r.student_id}
          className="mx-auto mb-4 max-w-xl border border-black bg-white p-5 text-[13px] text-black"
          style={{ pageBreakAfter: 'always' }}
        >
          <Letterhead />
          <p className="text-center text-sm font-semibold uppercase">Fee Reminder</p>
          <p className="mt-2">
            Date: {formatDateBS(today)}
          </p>
          <p className="mt-2">
            Dear guardian of <strong>{r.name}</strong> ({r.class_label}),
          </p>
          <p className="mt-2">
            our records show an outstanding balance of{' '}
            <strong>Rs. {formatMoney(r.balance)}</strong> against {r.name}
            {r.guardian_name ? ` (guardian: ${r.guardian_name})` : ''}. Kindly clear
            the dues at the school office at the earliest.
          </p>
          <p className="mt-6 text-right">Accounts section</p>
        </div>
      ))}
    </div>
  )

  return (
    <div>
      <div className="mb-3 flex items-end gap-3">
        <Field label="Minimum dues (Rs.)" className="w-44">
          <Input type="number" value={minDues} onChange={(e) => setMinDues(e.target.value)} />
        </Field>
        <span className="pb-2 text-sm text-ink-muted">
          {ledgers.isLoading ? 'Loading…' : `${rows.length} students owe above the threshold.`}
        </span>
        <div className="ml-auto">
          <PrintButton disabled={rows.length === 0} label="bills" />
        </div>
      </div>
      {ledgers.isError && (
        <EmptyState title="Couldn't load ledgers" hint={apiErrorMessage(ledgers.error)} />
      )}
      <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-surface-sunken p-4">
        {bills}
      </div>
      <PrintMirror>{bills}</PrintMirror>
    </div>
  )
}

// ------------------------------------------------------------- profiles

function ProfileSheets({ classId }: { classId: string }) {
  const students = useClassStudents(classId)
  const rows = students.data ?? []
  const sheets = (
    <div>
      {rows.map((s) => (
        <div
          key={s.id}
          className="mx-auto mb-4 max-w-xl border border-black bg-white p-5 text-[13px] text-black"
          style={{ pageBreakAfter: 'always' }}
        >
          <Letterhead />
          <p className="text-center text-sm font-semibold uppercase">Student Profile</p>
          <div className="mt-3 flex gap-4">
            {s.photo ? (
              <img src={s.photo} alt="" className="h-28 w-24 border border-black object-cover" />
            ) : (
              <div className="flex h-28 w-24 items-center justify-center border border-black text-[10px]">
                PHOTO
              </div>
            )}
            <table className="flex-1 text-left">
              <tbody>
                {[
                  ['Name', s.full_name],
                  ['Class', s.class_label],
                  ['Roll no', s.roll_no || '—'],
                  ['Gender', s.gender],
                  ['Contact', s.contact || '—'],
                ].map(([k, v]) => (
                  <tr key={k} className="border-b border-dotted border-black/40">
                    <th className="py-1 pr-3 font-semibold">{k}</th>
                    <td className="py-1 capitalize">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
  return (
    <div>
      <PrintButton disabled={rows.length === 0} label={`${rows.length} profiles`} />
      {students.isLoading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-surface-sunken p-4">
          {sheets}
        </div>
      )}
      <PrintMirror>{sheets}</PrintMirror>
    </div>
  )
}

// ------------------------------------------------------------- ID cards

function IdCards({ classId }: { classId: string }) {
  const { account } = useAuth()
  const students = useClassStudents(classId)
  const school = account?.school
  const rows = students.data ?? []
  const cards = (
    <div className="flex flex-wrap gap-3 bg-white p-4">
      {rows.map((s) => (
        <div
          key={s.id}
          className="h-[204px] w-[324px] overflow-hidden rounded-md border-2 border-black bg-white text-black"
        >
          <div className="bg-black px-2 py-1 text-center text-[11px] font-bold uppercase tracking-wide text-white">
            {school?.name}
          </div>
          <div className="flex gap-2 p-2">
            {s.photo ? (
              <img src={s.photo} alt="" className="h-24 w-20 border border-black object-cover" />
            ) : (
              <div className="flex h-24 w-20 items-center justify-center border border-black text-[9px]">
                PHOTO
              </div>
            )}
            <div className="text-[11px] leading-4">
              <p className="text-[13px] font-bold">{s.full_name}</p>
              <p>{s.class_label}</p>
              <p>Roll: {s.roll_no || '—'}</p>
              {s.contact && <p>Ph: {s.contact}</p>}
            </div>
          </div>
          <div className="border-t border-black px-2 py-0.5 text-center text-[9px]">
            {school?.address} · {school?.contact}
          </div>
        </div>
      ))}
    </div>
  )
  return (
    <div>
      <PrintButton disabled={rows.length === 0} label={`${rows.length} cards`} />
      {students.isLoading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-surface-sunken">
          {cards}
        </div>
      )}
      <PrintMirror>{cards}</PrintMirror>
    </div>
  )
}

// ------------------------------------------------------------- marks slips

function MarksSlips({ classId }: { classId: string }) {
  const exams = useExams()
  const [examId, setExamId] = useState('')
  const sheets = useSheets(examId || null, classId)
  const roster = useExamClassRoster(classId)
  const subjects = sheets.data ?? []
  const rows = roster.data ?? []

  const slip = (
    <div className="bg-white p-6 text-[12px] text-black">
      <Letterhead />
      <p className="text-center text-sm font-semibold uppercase">
        Marks Entry Slip — {(exams.data ?? []).find((e) => e.id === examId)?.name}
      </p>
      <table className="mt-3 w-full border-collapse border border-black">
        <thead>
          <tr>
            <th className="border border-black px-2 py-1 text-left">Student</th>
            <th className="border border-black px-2 py-1">Roll</th>
            {subjects.map((s) => (
              <th key={s.id} className="border border-black px-2 py-1">
                {s.subject_name}
                <span className="block text-[9px] font-normal">FM {Number(s.full_marks)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="border border-black px-2 py-1.5">{r.full_name}</td>
              <td className="border border-black px-2 py-1.5 text-center">{r.roll_no || ''}</td>
              {subjects.map((s) => (
                <td key={s.id} className="border border-black px-2 py-1.5" />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 text-right text-[11px]">
        Subject teacher signature: ______________________
      </p>
    </div>
  )

  return (
    <div>
      <div className="mb-3 flex items-end gap-3">
        <Field label="Exam" className="w-64">
          <Select value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">Choose an exam…</option>
            {(exams.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="ml-auto">
          <PrintButton disabled={!examId || subjects.length === 0} label="slip" />
        </div>
      </div>
      {!examId ? (
        <EmptyState title="Pick an exam" hint="The blank entry grid renders for its sheets." />
      ) : subjects.length === 0 ? (
        <EmptyState title="No result sheets" hint="Configure sheets for this exam + class first." />
      ) : (
        <>
          <div className="max-h-[60vh] overflow-auto rounded-xl border border-border">{slip}</div>
          <PrintMirror>{slip}</PrintMirror>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------- letters

function Letters({ classId }: { classId: string }) {
  const calendar = useCalendar()
  const students = useClassStudents(classId)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const rows = students.data ?? []
  const today = calendar.data?.today_bs ?? ''

  const letters = useMemo(
    () => (
      <div>
        {rows.map((s) => (
          <div
            key={s.id}
            className="mx-auto mb-4 max-w-xl border border-black bg-white p-6 text-[13px] text-black"
            style={{ pageBreakAfter: 'always' }}
          >
            <Letterhead />
            <p className="text-right">Date: {formatDateBS(today)}</p>
            {subject && <p className="mt-3 font-semibold">Subject: {subject}</p>}
            <p className="mt-3">
              Dear guardian of {s.full_name} ({s.class_label}),
            </p>
            <p className="mt-2 whitespace-pre-wrap">
              {body
                .replaceAll('{name}', s.full_name)
                .replaceAll('{class}', s.class_label)
                .replaceAll('{roll}', s.roll_no || '—')}
            </p>
            <p className="mt-8">Sincerely,</p>
            <p className="mt-6 border-t border-black pt-1">School administration</p>
          </div>
        ))}
      </div>
    ),
    [rows, subject, body, today],
  )

  return (
    <div>
      <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-2">
          <Field label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Body" hint="{name}, {class} and {roll} fill in per student">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft"
            />
          </Field>
        </div>
        <PrintButton disabled={rows.length === 0 || !body.trim()} label={`${rows.length} letters`} />
      </div>
      {body.trim() && (
        <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-border bg-surface-sunken p-4">
          {letters}
        </div>
      )}
      {body.trim() && <PrintMirror>{letters}</PrintMirror>}
    </div>
  )
}
