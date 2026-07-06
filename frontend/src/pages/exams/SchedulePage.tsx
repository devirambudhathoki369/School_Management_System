import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useClasses } from '../../lib/billing'
import { useClassSubjects, useExams, useSchedule } from '../../lib/exams'
import { formatDateBS } from '../../lib/format'
import {
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
import { IconCalendar, IconPlus, IconTrash } from '../../components/icons'

/** Exam schedule: one sitting per (class, subject) with date and times. */

export default function SchedulePage() {
  const exams = useExams()
  const [examId, setExamId] = useState('')
  const [adding, setAdding] = useState(false)
  const toast = useToast()
  const queryClient = useQueryClient()

  const exam = (exams.data ?? []).find((e) => e.id === examId) ?? null
  const schedule = useSchedule(examId || null)
  const classes = useClasses(exam ? [exam.academic_year] : [])

  const classLabel = (id: string) => classes.data?.find((c) => c.id === id)?.label ?? '…'

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/examinations/schedule/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'schedule'] })
      toast.success('Sitting removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const rows = [...(schedule.data ?? [])].sort((a, b) =>
    a.exam_date_bs.localeCompare(b.exam_date_bs),
  )

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Select
          value={examId}
          onChange={(e) => setExamId(e.target.value)}
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
        {examId && (
          <div className="sm:ml-auto">
            <Button onClick={() => setAdding(true)}>
              <IconPlus size={16} /> Add sitting
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {!examId ? (
          <EmptyState
            icon={<IconCalendar size={22} />}
            title="Pick an exam"
            hint="Sittings say which subject each class writes on which day."
          />
        ) : schedule.isLoading ? (
          <SkeletonRows rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No sittings scheduled"
            action={
              <Button onClick={() => setAdding(true)}>
                <IconPlus size={16} /> Schedule the first sitting
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="w-28 shrink-0">
                  <p className="text-sm font-medium">{formatDateBS(entry.exam_date_bs)}</p>
                  {entry.start_time && (
                    <p className="text-xs text-ink-muted">
                      {entry.start_time.slice(0, 5)}
                      {entry.end_time && `–${entry.end_time.slice(0, 5)}`}
                    </p>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{entry.subject_name}</p>
                  <p className="text-xs text-ink-muted">{classLabel(entry.class_info)}</p>
                </div>
                <button
                  aria-label="Remove sitting"
                  onClick={() => {
                    if (window.confirm(`Remove the ${entry.subject_name} sitting?`))
                      remove.mutate(entry.id)
                  }}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
                >
                  <IconTrash size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {adding && exam && (
        <SittingModal
          examId={exam.id}
          academicYear={exam.academic_year}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  )
}

function SittingModal({
  examId,
  academicYear,
  onClose,
}: {
  examId: string
  academicYear: string
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const classes = useClasses([academicYear])
  const [classId, setClassId] = useState('')
  const subjects = useClassSubjects(classId || null)
  const [subject, setSubject] = useState('')
  const [dateBs, setDateBs] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const save = useMutation({
    mutationFn: () =>
      api.post('/api/v1/examinations/schedule/', {
        exam: examId,
        class_info: classId,
        subject,
        exam_date_bs: dateBs,
        start_time: start || null,
        end_time: end || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'schedule'] })
      toast.success('Sitting scheduled.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title="Schedule a sitting"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={!classId || !subject || !dateBs}
            onClick={() => save.mutate()}
          >
            Add sitting
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="Class"
          error={classes.isError ? 'Classes unavailable — needs the academics permission.' : undefined}
        >
          <Select
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value)
              setSubject('')
            }}
            autoFocus
          >
            <option value="">Choose a class…</option>
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Subject">
          <Select value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!classId}>
            <option value="">Choose a subject…</option>
            {(subjects.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date (BS)">
            <Input value={dateBs} onChange={(e) => setDateBs(e.target.value)} placeholder="2083-04-05" />
          </Field>
          <Field label="Starts">
            <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ends">
            <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
