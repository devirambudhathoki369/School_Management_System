import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  choiceLabel,
  useAcademicYearsFull,
  useBatches,
  useCourses,
  type BatchRow,
} from '../../lib/academics'
import { useAuth } from '../../lib/auth'
import {
  Badge,
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
import { IconPencil, IconPlus, IconTrash } from '../../components/icons'

/**
 * Batch (cohort/intake) registry for higher-ed programs. The batch is a
 * student's immutable identity — the semester/year is just a counter that
 * advances on promotion. "Promote cohorts" runs the batch-aware year-end
 * step (dry-run preview first, then apply; admin only).
 */

const HIGHER_ED = new Set(['bachelor', 'master', 'pre_diploma', 'diploma'])

interface PromotePlan {
  term_kind: 'year' | 'semester'
  program_length: number
  moves: Array<{ student: string; from: string; to: string; level: number }>
  skipped: Array<{ student: string; from: string; level: number; reason: string }>
  batch_advances: Array<{ batch: string; to: number }>
  applied: boolean
}

export default function BatchesPage() {
  const batches = useBatches()
  const [editing, setEditing] = useState<BatchRow | 'new' | null>(null)
  const toast = useToast()
  const queryClient = useQueryClient()

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/academics/batches/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics', 'batches'] })
      toast.success('Batch removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const rows = batches.data ?? []
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div>
            <h3 className="text-base font-semibold">Batches</h3>
            <p className="text-xs text-ink-muted">
              Cohorts/intakes for bachelor, master and diploma programs — a
              student&apos;s batch never changes; their semester does.
            </p>
          </div>
          <Button onClick={() => setEditing('new')}>
            <IconPlus size={16} /> New batch
          </Button>
        </div>
        {batches.isLoading ? (
          <div className="p-4">
            <SkeletonRows rows={4} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No batches yet"
            hint="Register each intake (e.g. batch 2079 of BCA) so two cohorts can run the same semester side by side."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-ink-muted">
                  <th className="px-4 py-2.5 sm:px-5">Batch</th>
                  <th className="px-3 py-2.5">Course</th>
                  <th className="px-3 py-2.5">Admitted in</th>
                  <th className="px-3 py-2.5">Current term</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium sm:px-5">{b.year}</td>
                    <td className="px-3 py-2.5">
                      {b.course_name || '—'}
                      {b.education_level && (
                        <span className="ml-1.5 text-xs text-ink-muted">
                          {choiceLabel(b.education_level)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{b.start_academic_year_name || '—'}</td>
                    <td className="px-3 py-2.5">
                      {b.current_semester
                        ? `Semester ${b.current_semester}`
                        : b.current_year
                          ? `Year ${b.current_year}`
                          : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {b.graduated ? (
                        <Badge tone="positive">Graduated</Badge>
                      ) : (
                        <Badge tone="accent">Running</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>
                          <IconPencil size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (window.confirm(`Delete batch ${b.year}?`)) remove.mutate(b.id)
                          }}
                        >
                          <IconTrash size={15} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PromoteProgramCard />

      {editing && (
        <BatchModal batch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function BatchModal({ batch, onClose }: { batch: BatchRow | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const courses = useCourses()
  const years = useAcademicYearsFull()
  const [course, setCourse] = useState(batch?.course ?? '')
  const [year, setYear] = useState(batch?.year ?? '')
  const [startYear, setStartYear] = useState(batch?.start_academic_year ?? '')
  const [termKind, setTermKind] = useState<'semester' | 'year'>(
    batch?.current_year ? 'year' : 'semester',
  )
  const [term, setTerm] = useState(
    (batch?.current_semester ?? batch?.current_year)?.toString() ?? '',
  )
  const [graduated, setGraduated] = useState(batch?.graduated ?? false)

  const programCourses = (courses.data ?? []).filter((c) => HIGHER_ED.has(c.education_level))

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        course: course || null,
        year: year.trim(),
        start_academic_year: startYear || null,
        current_semester: termKind === 'semester' && term ? Number(term) : null,
        current_year: termKind === 'year' && term ? Number(term) : null,
        graduated,
      }
      return batch
        ? api.patch(`/api/v1/academics/batches/${batch.id}/`, payload)
        : api.post('/api/v1/academics/batches/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics', 'batches'] })
      toast.success(batch ? 'Batch updated.' : 'Batch registered.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={batch ? `Edit batch ${batch.year}` : 'New batch'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!year.trim()} onClick={() => save.mutate()}>
            {batch ? 'Save changes' : 'Register batch'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Course">
          <Select value={course} onChange={(e) => setCourse(e.target.value)}>
            <option value="">Choose a program…</option>
            {programCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {choiceLabel(c.education_level)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Admission year (BS)" hint="The cohort's stable name">
            <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2079" />
          </Field>
          <Field label="Admitted in academic year">
            <Select value={startYear} onChange={(e) => setStartYear(e.target.value)}>
              <option value="">—</option>
              {(years.data ?? []).map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Term kind">
            <Select
              value={termKind}
              onChange={(e) => setTermKind(e.target.value as 'semester' | 'year')}
            >
              <option value="semester">Semester-wise</option>
              <option value="year">Year-wise</option>
            </Select>
          </Field>
          <Field label={termKind === 'semester' ? 'Current semester' : 'Current year'}>
            <Input
              type="number"
              min={1}
              max={12}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="1"
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={graduated}
            onChange={(e) => setGraduated(e.target.checked)}
            className="size-4 accent-accent"
          />
          Graduated (cohort finished its final term)
        </label>
      </div>
    </Modal>
  )
}

function PromoteProgramCard() {
  const { account } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const courses = useCourses()
  const [courseId, setCourseId] = useState('')
  const [plan, setPlan] = useState<PromotePlan | null>(null)

  const programCourses = useMemo(
    () => (courses.data ?? []).filter((c) => HIGHER_ED.has(c.education_level)),
    [courses.data],
  )

  const run = useMutation({
    mutationFn: async (apply: boolean) =>
      (
        await api.post<PromotePlan>(
          `/api/v1/academics/courses/${courseId}/promote-program/`,
          { apply },
        )
      ).data,
    onSuccess: (data, apply) => {
      setPlan(data)
      if (apply && data.applied) {
        queryClient.invalidateQueries({ queryKey: ['academics'] })
        toast.success(`Promoted ${data.moves.length} students.`)
      }
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  if (account?.role !== 'admin') return null

  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <h3 className="text-base font-semibold">Promote cohorts</h3>
      <p className="mt-0.5 text-xs text-ink-muted">
        Batch-aware year-end step: moves every level of a program up one
        semester/year (section-preserving) and advances the batch counters.
        Run it AFTER the academic-year roll. Money is never touched.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Program" className="min-w-56">
          <Select
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value)
              setPlan(null)
            }}
          >
            <option value="">Choose a program…</option>
            {programCourses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="secondary"
          disabled={!courseId}
          busy={run.isPending && !plan}
          onClick={() => run.mutate(false)}
        >
          Preview (dry run)
        </Button>
        {plan && !plan.applied && plan.moves.length > 0 && (
          <Button busy={run.isPending} onClick={() => run.mutate(true)}>
            Apply — promote {plan.moves.length} students
          </Button>
        )}
      </div>

      {plan && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <Badge tone={plan.applied ? 'positive' : 'accent'}>
              {plan.applied ? 'Applied' : 'Dry run'}
            </Badge>{' '}
            <span className="text-ink-muted">
              {plan.term_kind === 'year' ? 'Year-wise' : 'Semester-wise'} program,{' '}
              {plan.program_length} terms — {plan.moves.length} students to move,{' '}
              {plan.batch_advances.length} batch counters to advance.
            </span>
          </p>
          {plan.moves.length === 0 && (
            <p className="text-ink-muted">Nothing to promote.</p>
          )}
          {plan.skipped.length > 0 && (
            <div className="rounded-lg bg-warning-soft px-3 py-2 text-xs">
              {plan.skipped.length} students skipped (no matching section at the
              next level) — they stay where they are, never dumped into another
              stream.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
