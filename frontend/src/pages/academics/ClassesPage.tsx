import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  EDUCATION_LEVELS,
  FACULTIES,
  GRADES,
  choiceLabel,
  defaultYearId,
  useAcademicYearsFull,
  useClassesOfYear,
  useCourses,
  useSections,
  useYearPointersFull,
  type ClassInfoFull,
} from '../../lib/academics'
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
import { IconBook, IconPencil, IconPlus, IconTrash } from '../../components/icons'

/**
 * Classes of one academic year. A class is the unique tuple students belong
 * to (invariant A1) — the server rejects duplicate tuples, the UI just makes
 * building them pleasant.
 */
export default function ClassesPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const years = useAcademicYearsFull()
  const pointers = useYearPointersFull()
  const [yearId, setYearId] = useState('')
  const classes = useClassesOfYear(yearId || null)
  const [editing, setEditing] = useState<ClassInfoFull | 'new' | null>(null)

  useEffect(() => {
    if (!yearId && years.data) setYearId(defaultYearId(years.data, pointers.data))
  }, [yearId, years.data, pointers.data])

  const rows = [...(classes.data ?? [])].sort((a, b) => a.label.localeCompare(b.label))

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/academics/classes/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics'] })
      toast.success('Class removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={yearId}
          onChange={(e) => setYearId(e.target.value)}
          aria-label="Academic year"
          className="w-56"
        >
          <option value="">{years.isLoading ? 'Loading…' : 'Choose a year…'}</option>
          {(years.data ?? []).map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
              {y.closed ? ' (closed)' : ''}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button onClick={() => setEditing('new')} disabled={!yearId}>
          <IconPlus size={16} /> New class
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {classes.isLoading && yearId ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconBook size={22} />}
            title={yearId ? 'No classes in this year' : 'Pick an academic year'}
            hint={yearId ? 'Create the classes students enrol into.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {c.display_name || c.label}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {[
                      choiceLabel(EDUCATION_LEVELS, c.education_level),
                      choiceLabel(GRADES, c.grade),
                      choiceLabel(FACULTIES, c.faculty),
                      c.year ? `Year ${c.year}` : '',
                      c.semester ? `Semester ${c.semester}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Badge tone={c.students_count > 0 ? 'accent' : 'neutral'}>
                  {c.students_count} student{c.students_count === 1 ? '' : 's'}
                </Badge>
                <button
                  aria-label={`Edit ${c.label}`}
                  onClick={() => setEditing(c)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <button
                  aria-label={`Delete ${c.label}`}
                  onClick={() => {
                    if (window.confirm(`Delete class “${c.label}”?`)) remove.mutate(c.id)
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

      {editing && (
        <ClassModal
          cls={editing === 'new' ? null : editing}
          yearId={yearId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ClassModal({
  cls,
  yearId,
  onClose,
}: {
  cls: ClassInfoFull | null
  yearId: string
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const courses = useCourses()
  const sections = useSections()
  const [form, setForm] = useState({
    education_level: cls?.education_level ?? 'school',
    grade: cls?.grade ?? '',
    faculty: cls?.faculty ?? '',
    course: cls?.course ?? '',
    section: cls?.section ?? '',
    year: cls?.year ? String(cls.year) : '',
    semester: cls?.semester ? String(cls.semester) : '',
    display_name: cls?.display_name ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const higher = ['pre_diploma', 'diploma', 'bachelor', 'master'].includes(
    form.education_level,
  )

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        education_level: form.education_level,
        grade: form.grade,
        faculty: form.faculty,
        course: form.course || null,
        section: form.section || null,
        year: form.year ? Number(form.year) : null,
        semester: form.semester ? Number(form.semester) : null,
        display_name: form.display_name,
        academic_year: cls?.academic_year ?? yearId,
      }
      return cls
        ? api.patch(`/api/v1/academics/classes/${cls.id}/`, payload)
        : api.post('/api/v1/academics/classes/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics'] })
      toast.success(cls ? 'Class updated.' : 'Class created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={cls ? `Edit ${cls.label}` : 'New class'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            {cls ? 'Save changes' : 'Create class'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Education level">
          <Select value={form.education_level} onChange={set('education_level')}>
            {EDUCATION_LEVELS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Grade" hint={higher ? 'Usually blank for higher education.' : undefined}>
          <Select value={form.grade} onChange={set('grade')}>
            <option value="">—</option>
            {GRADES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Faculty">
          <Select value={form.faculty} onChange={set('faculty')}>
            <option value="">—</option>
            {FACULTIES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Course">
          <Select value={form.course} onChange={set('course')}>
            <option value="">—</option>
            {(courses.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Section">
          <Select value={form.section} onChange={set('section')}>
            <option value="">—</option>
            {(sections.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year (1–4)">
            <Input type="number" min={1} max={4} value={form.year} onChange={set('year')} />
          </Field>
          <Field label="Semester">
            <Input
              type="number"
              min={1}
              max={10}
              value={form.semester}
              onChange={set('semester')}
            />
          </Field>
        </div>
        <Field
          label="Display name"
          hint="Optional label shown on documents, e.g. “BBS 1st Year”."
          className="sm:col-span-2"
        >
          <Input value={form.display_name} onChange={set('display_name')} />
        </Field>
      </div>
    </Modal>
  )
}
