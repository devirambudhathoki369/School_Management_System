import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  EDUCATION_LEVELS,
  choiceLabel,
  useCourses,
  useSections,
  type CourseRow,
  type SectionRow,
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
import { IconPencil, IconPlus, IconTrash } from '../../components/icons'

/**
 * Structure vocabulary: courses (BBS, +2 Science…) and sections (A, B,
 * Morning…). Classes reference these, so deletion is server-guarded once
 * a class uses them.
 */
export default function StructurePage() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <CoursesCard />
      <SectionsCard />
    </div>
  )
}

function CoursesCard() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const courses = useCourses()
  const [editing, setEditing] = useState<CourseRow | 'new' | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/academics/courses/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics', 'courses'] })
      toast.success('Course removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="text-base font-semibold">Courses</h3>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New course
        </Button>
      </div>
      {courses.isLoading ? (
        <SkeletonRows rows={5} />
      ) : (courses.data ?? []).length === 0 ? (
        <EmptyState title="No courses" hint="Add programmes like BBS or +2 Science." />
      ) : (
        <ul className="divide-y divide-border">
          {(courses.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-5 py-3">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</p>
              <Badge>{choiceLabel(EDUCATION_LEVELS, c.education_level)}</Badge>
              <button
                aria-label={`Edit ${c.name}`}
                onClick={() => setEditing(c)}
                className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
              >
                <IconPencil size={16} />
              </button>
              <button
                aria-label={`Delete ${c.name}`}
                onClick={() => {
                  if (window.confirm(`Delete course “${c.name}”?`)) remove.mutate(c.id)
                }}
                className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <CourseModal
          course={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function CourseModal({ course, onClose }: { course: CourseRow | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(course?.name ?? '')
  const [level, setLevel] = useState(course?.education_level ?? 'bachelor')
  const [totalYears, setTotalYears] = useState(course?.total_years?.toString() ?? '')
  const [totalSemesters, setTotalSemesters] = useState(
    course?.total_semesters?.toString() ?? '',
  )

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        education_level: level,
        total_years: totalYears ? Number(totalYears) : null,
        total_semesters: totalSemesters ? Number(totalSemesters) : null,
      }
      return course
        ? api.patch(`/api/v1/academics/courses/${course.id}/`, payload)
        : api.post('/api/v1/academics/courses/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics', 'courses'] })
      toast.success(course ? 'Course updated.' : 'Course created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={course ? `Edit ${course.name}` : 'New course'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            {course ? 'Save changes' : 'Create course'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="BBS" />
        </Field>
        <Field label="Education level">
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            {EDUCATION_LEVELS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total years" hint="Year-wise programs (Diploma Forestry: 3)">
            <Input
              type="number"
              min={1}
              max={6}
              value={totalYears}
              onChange={(e) => {
                setTotalYears(e.target.value)
                if (e.target.value) setTotalSemesters('')
              }}
              placeholder="—"
            />
          </Field>
          <Field label="Total semesters" hint="Semester-wise programs (BCA: 8)">
            <Input
              type="number"
              min={1}
              max={12}
              value={totalSemesters}
              onChange={(e) => {
                setTotalSemesters(e.target.value)
                if (e.target.value) setTotalYears('')
              }}
              placeholder="—"
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}

function SectionsCard() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const sections = useSections()
  const [editing, setEditing] = useState<SectionRow | 'new' | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/academics/sections/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics', 'sections'] })
      toast.success('Section removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h3 className="text-base font-semibold">Sections</h3>
        <Button variant="secondary" onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New section
        </Button>
      </div>
      {sections.isLoading ? (
        <SkeletonRows rows={5} />
      ) : (sections.data ?? []).length === 0 ? (
        <EmptyState title="No sections" hint="Add labels like A, B or Morning." />
      ) : (
        <ul className="divide-y divide-border">
          {(sections.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{s.name}</p>
              <button
                aria-label={`Edit ${s.name}`}
                onClick={() => setEditing(s)}
                className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
              >
                <IconPencil size={16} />
              </button>
              <button
                aria-label={`Delete ${s.name}`}
                onClick={() => {
                  if (window.confirm(`Delete section “${s.name}”?`)) remove.mutate(s.id)
                }}
                className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
              >
                <IconTrash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <SectionModal
          section={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function SectionModal({
  section,
  onClose,
}: {
  section: SectionRow | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(section?.name ?? '')

  const save = useMutation({
    mutationFn: () =>
      section
        ? api.patch(`/api/v1/academics/sections/${section.id}/`, { name: name.trim() })
        : api.post('/api/v1/academics/sections/', { name: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics', 'sections'] })
      toast.success(section ? 'Section updated.' : 'Section created.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={section ? `Edit ${section.name}` : 'New section'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>
            {section ? 'Save changes' : 'Create section'}
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="A" />
      </Field>
    </Modal>
  )
}
