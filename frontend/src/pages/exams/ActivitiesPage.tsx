import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { fetchAllPages } from '../../lib/billing'
import { useClassesOfYear } from '../../lib/academics'
import { useExams, useExamClassRoster } from '../../lib/exams'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconPlus, IconTrash } from '../../components/icons'

/**
 * Extra (co-curricular) activities — the legacy setup + entry pair. The
 * vocabulary is per school (Discipline, Handwriting, Sports…); grades are
 * entered per exam and class in one grid and ride into marksheets.
 */

interface ActivityRow {
  id: string
  name: string
}

interface GradeRow {
  id: string
  exam: string
  class_info: string
  student: string
  activity: string
  grade: string
}

function useActivities() {
  return useQuery({
    queryKey: ['exams', 'activities'],
    queryFn: () => fetchAllPages<ActivityRow>('/api/v1/examinations/activities/'),
  })
}

export default function ActivitiesPage() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
      <DefinitionsCard />
      <EntryCard />
    </div>
  )
}

function DefinitionsCard() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const activities = useActivities()
  const [name, setName] = useState('')

  const create = useMutation({
    mutationFn: () => api.post('/api/v1/examinations/activities/', { name: name.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'activities'] })
      setName('')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/examinations/activities/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exams', 'activities'] }),
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="self-start rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold">Activities</h3>
      <p className="mt-0.5 text-xs text-ink-muted">
        The school&apos;s co-curricular vocabulary.
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) create.mutate()
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Discipline, Sports…"
        />
        <Button type="submit" busy={create.isPending} disabled={!name.trim()}>
          <IconPlus size={16} />
        </Button>
      </form>
      <ul className="mt-3 space-y-1">
        {activities.isLoading ? (
          <SkeletonRows rows={3} />
        ) : (
          (activities.data ?? []).map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-lg px-2.5 py-1.5 text-sm hover:bg-surface-muted"
            >
              {a.name}
              <button
                aria-label={`Delete ${a.name}`}
                onClick={() => {
                  if (window.confirm(`Delete activity “${a.name}”?`)) remove.mutate(a.id)
                }}
                className="text-ink-faint hover:text-danger"
              >
                <IconTrash size={14} />
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

function EntryCard() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const exams = useExams()
  const activities = useActivities()
  const [examId, setExamId] = useState('')
  const [classId, setClassId] = useState('')
  const exam = (exams.data ?? []).find((e) => e.id === examId) ?? null
  const classes = useClassesOfYear(exam?.academic_year ?? null)
  const roster = useExamClassRoster(classId || null)

  const existing = useQuery({
    queryKey: ['exams', 'activity-grades', examId, classId],
    queryFn: () =>
      fetchAllPages<GradeRow>('/api/v1/examinations/activity-grades/', {
        exam: examId,
        class_info: classId,
      }),
    enabled: !!examId && !!classId,
  })

  // (student, activity) -> draft grade; seeded from existing rows.
  const [draft, setDraft] = useState<Record<string, string>>({})
  useEffect(() => {
    if (existing.data) {
      const seed: Record<string, string> = {}
      for (const g of existing.data) seed[`${g.student}:${g.activity}`] = g.grade
      setDraft(seed)
    }
  }, [existing.data])

  const byKey = useMemo(() => {
    const map: Record<string, GradeRow> = {}
    for (const g of existing.data ?? []) map[`${g.student}:${g.activity}`] = g
    return map
  }, [existing.data])

  const save = useMutation({
    mutationFn: async () => {
      let changed = 0
      for (const [key, grade] of Object.entries(draft)) {
        const [student, activity] = key.split(':')
        const row = byKey[key]
        const value = grade.trim()
        if (row && value === row.grade) continue
        if (row && !value) {
          await api.delete(`/api/v1/examinations/activity-grades/${row.id}/`)
          changed++
        } else if (row) {
          await api.patch(`/api/v1/examinations/activity-grades/${row.id}/`, { grade: value })
          changed++
        } else if (value) {
          await api.post('/api/v1/examinations/activity-grades/', {
            exam: examId, class_info: classId, student, activity, grade: value,
          })
          changed++
        }
      }
      return changed
    },
    onSuccess: (changed) => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'activity-grades'] })
      toast.success(changed ? `${changed} grades saved.` : 'Nothing to save.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const cols = activities.data ?? []
  const rows = roster.data ?? []

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Exam" className="sm:w-56">
          <Select
            value={examId}
            onChange={(e) => {
              setExamId(e.target.value)
              setClassId('')
            }}
          >
            <option value="">Choose an exam…</option>
            {(exams.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Class" className="sm:w-56">
          <Select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            disabled={!examId}
          >
            <option value="">Choose a class…</option>
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        {examId && classId && rows.length > 0 && (
          <Button className="sm:ml-auto" busy={save.isPending} onClick={() => save.mutate()}>
            Save grades
          </Button>
        )}
      </div>

      {!examId || !classId ? (
        <EmptyState title="Pick an exam and a class" hint="The grade grid loads here." />
      ) : roster.isLoading || existing.isLoading ? (
        <div className="mt-4">
          <SkeletonRows rows={6} />
        </div>
      ) : cols.length === 0 ? (
        <EmptyState title="No activities defined" hint="Add the vocabulary on the left first." />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Student</th>
                {cols.map((a) => (
                  <th key={a.id} className="px-2 py-2 text-left font-medium">
                    {a.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-2 py-1.5 font-medium">{r.full_name}</td>
                  {cols.map((a) => {
                    const key = `${r.id}:${a.id}`
                    return (
                      <td key={a.id} className="px-1.5 py-1">
                        <Input
                          value={draft[key] ?? ''}
                          onChange={(e) =>
                            setDraft((d) => ({ ...d, [key]: e.target.value }))
                          }
                          placeholder="—"
                          className="h-8 w-24 text-center"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-faint">
            Letter or word grades (A, B, Excellent…). Clearing a cell removes the grade.
          </p>
        </div>
      )}
    </div>
  )
}
