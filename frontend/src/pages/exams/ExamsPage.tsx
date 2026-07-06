import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAcademicYears, useCalendar, useClasses, useYearPointers } from '../../lib/billing'
import { useExams, type Exam } from '../../lib/exams'
import {
  AmountInput,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconCheck, IconClipboard, IconPencil, IconPlus } from '../../components/icons'

/**
 * Exams: the terms a school examines in, per academic year. Publishing is
 * per (exam, class) — it stamps the date, computes dense-rank positions
 * across sibling sections, and locks the sheets against staff edits.
 */

export default function ExamsPage() {
  const exams = useExams()
  const years = useAcademicYears()
  const [editing, setEditing] = useState<Exam | 'new' | null>(null)
  const [publishing, setPublishing] = useState<Exam | null>(null)

  const yearName = useMemo(() => {
    const map = new Map((years.data ?? []).map((y) => [y.id, y.name]))
    return (id: string) => map.get(id) ?? '—'
  }, [years.data])

  const rows = exams.data ?? []

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New exam
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {exams.isLoading ? (
          <SkeletonRows rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconClipboard size={22} />}
            title="No exams yet"
            hint="Create the term's exam, define its result sheets, then enter marks."
            action={
              <Button onClick={() => setEditing('new')}>
                <IconPlus size={16} /> Create the first exam
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((exam) => (
              <li key={exam.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{exam.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    AY {yearName(exam.academic_year)}
                    {exam.inclusion_weight && Number(exam.inclusion_weight) > 0 && (
                      <> · carries {Number(exam.inclusion_weight)}% into the final</>
                    )}
                    {exam.include_attendance && <> · attendance counted</>}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setPublishing(exam)}>
                  <IconCheck size={15} /> Publish
                </Button>
                <button
                  aria-label={`Edit ${exam.name}`}
                  onClick={() => setEditing(exam)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <ExamModal exam={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {publishing && <PublishModal exam={publishing} onClose={() => setPublishing(null)} />}
    </div>
  )
}

function ExamModal({ exam, onClose }: { exam: Exam | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const years = useAcademicYears()
  const pointers = useYearPointers()
  const runningYears = new Set((pointers.data ?? []).map((p) => p.academic_year))

  const [name, setName] = useState(exam?.name ?? '')
  const [year, setYear] = useState(exam?.academic_year ?? '')
  const [weight, setWeight] = useState(exam?.inclusion_weight ?? '')
  const [attendance, setAttendance] = useState(exam?.include_attendance ?? false)

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        academic_year: year,
        inclusion_weight: weight === '' ? null : weight,
        include_attendance: attendance,
      }
      if (exam) return api.patch(`/api/v1/examinations/exams/${exam.id}/`, payload)
      return api.post('/api/v1/examinations/exams/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams'] })
      toast.success(exam ? 'Exam updated.' : 'Exam created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const options = (years.data ?? []).filter((y) => !y.closed || y.id === exam?.academic_year)

  return (
    <Modal
      open
      onClose={onClose}
      title={exam ? `Edit ${exam.name}` : 'New exam'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!name.trim() || !year} onClick={() => save.mutate()}>
            {exam ? 'Save changes' : 'Create exam'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="First terminal exam" autoFocus />
        </Field>
        <Field label="Academic year">
          <Select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Choose a year…</option>
            {options.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {runningYears.has(y.id) ? ' (running)' : ''}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 items-end gap-3">
          <Field
            label="Carried into final (%)"
            hint="How much of this exam counts in the aggregate."
          >
            <AmountInput value={weight ?? ''} max="100" onChange={(e) => setWeight(e.target.value)} />
          </Field>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={attendance}
              onChange={(e) => setAttendance(e.target.checked)}
              className="size-4 accent-(--color-accent-strong)"
            />
            Count attendance
          </label>
        </div>
      </div>
    </Modal>
  )
}

function PublishModal({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const calendar = useCalendar()
  const classes = useClasses([exam.academic_year])
  const [classId, setClassId] = useState('')
  const [dateBs, setDateBs] = useState('')
  const date = dateBs || calendar.data?.today_bs || ''

  const publish = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ published_sheets: number }>(
          `/api/v1/examinations/exams/${exam.id}/publish/`,
          { class_info: classId, published_date_bs: date },
        )
      ).data,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['exams'] })
      toast.success(`${res.published_sheets} result sheet${res.published_sheets === 1 ? '' : 's'} published.`)
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={`Publish ${exam.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={publish.isPending} disabled={!classId || !date} onClick={() => publish.mutate()}>
            Publish results
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Class"
          error={classes.isError ? 'Classes unavailable — needs the academics permission.' : undefined}
        >
          <Select value={classId} onChange={(e) => setClassId(e.target.value)} autoFocus>
            <option value="">Choose a class…</option>
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Published date (BS)">
          <Input value={date} onChange={(e) => setDateBs(e.target.value)} />
        </Field>
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          Publishing computes positions across the class and its sibling sections and locks the
          sheets — staff can no longer edit marks (the admin still can).
        </p>
      </div>
    </Modal>
  )
}
