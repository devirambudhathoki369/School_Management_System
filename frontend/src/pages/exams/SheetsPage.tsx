import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useClasses } from '../../lib/billing'
import {
  useClassSubjects,
  useExams,
  useSheets,
  type ResultSheet,
} from '../../lib/exams'
import { formatDateBS, formatMoney } from '../../lib/format'
import {
  AmountInput,
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconArrowRight, IconClipboard, IconPencil, IconPlus } from '../../components/icons'

/**
 * Result sheets: one per (exam, class, subject) — the marks configuration
 * (full/pass, theory/practical split) plus publication state. Marks entry
 * opens from here.
 */

export default function SheetsPage() {
  const exams = useExams()
  const [examId, setExamId] = useState('')
  const [classId, setClassId] = useState('')
  const [editing, setEditing] = useState<ResultSheet | 'new' | null>(null)

  const exam = (exams.data ?? []).find((e) => e.id === examId) ?? null
  const classes = useClasses(exam ? [exam.academic_year] : [])
  const sheets = useSheets(examId || null, classId || null)

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
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
          <option value="">
            {classes.isError ? 'Classes unavailable (academics permission)' : 'Choose a class…'}
          </option>
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        {examId && classId && (
          <div className="sm:ml-auto">
            <Button onClick={() => setEditing('new')}>
              <IconPlus size={16} /> New sheet
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {!examId || !classId ? (
          <EmptyState
            icon={<IconClipboard size={22} />}
            title="Pick an exam and a class"
            hint="Each subject gets one result sheet holding its marks scheme and the students' marks."
          />
        ) : sheets.isLoading ? (
          <SkeletonRows rows={5} />
        ) : (sheets.data?.length ?? 0) === 0 ? (
          <EmptyState
            title="No result sheets for this class yet"
            action={
              <Button onClick={() => setEditing('new')}>
                <IconPlus size={16} /> Create the first sheet
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {sheets.data!.map((sheet) => (
              <li key={sheet.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{sheet.subject_name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    FM {formatMoney(sheet.full_marks)} · PM {formatMoney(sheet.pass_marks)}
                    {sheet.full_marks_practical && Number(sheet.full_marks_practical) > 0 && (
                      <> · Th {formatMoney(sheet.full_marks_theory)} + Pr {formatMoney(sheet.full_marks_practical)}</>
                    )}
                  </p>
                </div>
                {sheet.is_published ? (
                  <Badge tone="positive">published {formatDateBS(sheet.published_date_bs)}</Badge>
                ) : (
                  <Badge>draft</Badge>
                )}
                <button
                  aria-label={`Edit ${sheet.subject_name} sheet`}
                  onClick={() => setEditing(sheet)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <Link to={`/exams/sheets/${sheet.id}/marks`}>
                  <Button variant="secondary">
                    Marks <IconArrowRight size={14} />
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && examId && classId && (
        <SheetModal
          examId={examId}
          classId={classId}
          sheet={editing === 'new' ? null : editing}
          existingSubjects={(sheets.data ?? []).map((s) => s.subject)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function SheetModal({
  examId,
  classId,
  sheet,
  existingSubjects,
  onClose,
}: {
  examId: string
  classId: string
  sheet: ResultSheet | null
  existingSubjects: string[]
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const subjects = useClassSubjects(classId)

  const [subject, setSubject] = useState(sheet?.subject ?? '')
  const [fullMarks, setFullMarks] = useState(sheet?.full_marks ?? '100')
  const [passMarks, setPassMarks] = useState(sheet?.pass_marks ?? '40')
  const [split, setSplit] = useState(
    !!sheet?.full_marks_practical && Number(sheet.full_marks_practical) > 0,
  )
  const [fmTheory, setFmTheory] = useState(sheet?.full_marks_theory ?? '')
  const [pmTheory, setPmTheory] = useState(sheet?.pass_marks_theory ?? '')
  const [fmPractical, setFmPractical] = useState(sheet?.full_marks_practical ?? '')
  const [pmPractical, setPmPractical] = useState(sheet?.pass_marks_practical ?? '')

  const choices = useMemo(
    () =>
      (subjects.data ?? []).filter(
        (s) => sheet ? s.id === sheet.subject : !existingSubjects.includes(s.id),
      ),
    [subjects.data, sheet, existingSubjects],
  )

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        exam: examId,
        class_info: classId,
        subject,
        full_marks: fullMarks,
        pass_marks: passMarks,
        full_marks_theory: split ? fmTheory || null : null,
        pass_marks_theory: split ? pmTheory || null : null,
        full_marks_practical: split ? fmPractical || null : null,
        pass_marks_practical: split ? pmPractical || null : null,
      }
      if (sheet) return api.patch(`/api/v1/examinations/sheets/${sheet.id}/`, payload)
      return api.post('/api/v1/examinations/sheets/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'sheets'] })
      toast.success(sheet ? 'Sheet updated.' : 'Result sheet created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={sheet ? `Edit ${sheet.subject_name} sheet` : 'New result sheet'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={!subject || !fullMarks || !passMarks}
            onClick={() => save.mutate()}
          >
            {sheet ? 'Save changes' : 'Create sheet'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Subject">
          <Select value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!!sheet} autoFocus>
            <option value="">Choose a subject…</option>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Full marks">
            <AmountInput value={fullMarks} onChange={(e) => setFullMarks(e.target.value)} />
          </Field>
          <Field label="Pass marks">
            <AmountInput value={passMarks} onChange={(e) => setPassMarks(e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={split}
            onChange={(e) => setSplit(e.target.checked)}
            className="size-4 accent-(--color-accent-strong)"
          />
          Separate theory and practical marks
        </label>
        {split && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Theory FM / PM">
              <div className="flex gap-2">
                <AmountInput value={fmTheory ?? ''} onChange={(e) => setFmTheory(e.target.value)} placeholder="FM" />
                <AmountInput value={pmTheory ?? ''} onChange={(e) => setPmTheory(e.target.value)} placeholder="PM" />
              </div>
            </Field>
            <Field label="Practical FM / PM">
              <div className="flex gap-2">
                <AmountInput value={fmPractical ?? ''} onChange={(e) => setFmPractical(e.target.value)} placeholder="FM" />
                <AmountInput value={pmPractical ?? ''} onChange={(e) => setPmPractical(e.target.value)} placeholder="PM" />
              </div>
            </Field>
          </div>
        )}
      </div>
    </Modal>
  )
}
