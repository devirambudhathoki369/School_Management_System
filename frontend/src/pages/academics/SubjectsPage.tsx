import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useSubjectsOfClass, type SubjectFull } from '../../lib/academics'
import { useExamClassRoster } from '../../lib/exams'
import ClassPicker from '../../components/ClassPicker'
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
 * Subjects of one class, in teaching order. Partitioned subjects (S3) keep
 * theory in the base fields and the practical part beside it. Deletion is
 * server-guarded: protected (S2) or in-use (S1) subjects never go away.
 */
export default function SubjectsPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [classId, setClassId] = useState('')
  const subjects = useSubjectsOfClass(classId || null)
  const [editing, setEditing] = useState<SubjectFull | 'new' | null>(null)
  const [assigning, setAssigning] = useState<SubjectFull | null>(null)

  const rows = [...(subjects.data ?? [])].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/academics/subjects/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics', 'subjects'] })
      toast.success('Subject removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 rounded-xl border border-border bg-surface p-4">
        <ClassPicker classId={classId} onChange={(id) => setClassId(id)} />
      </div>

      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing('new')} disabled={!classId}>
          <IconPlus size={16} /> New subject
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {subjects.isLoading && classId ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconBook size={22} />}
            title={classId ? 'No subjects yet' : 'Pick a class'}
            hint={classId ? 'Add the subjects this class studies.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {s.name}
                    {s.code && <span className="ml-1.5 text-xs text-ink-faint">({s.code})</span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {Number(s.credit_hours)} credit hrs
                    {s.name_practical &&
                      ` · practical: ${s.name_practical}${
                        s.credit_hours_practical
                          ? ` (${Number(s.credit_hours_practical)} hrs)`
                          : ''
                      }`}
                  </p>
                </div>
                {s.type === 'optional' && (
                  <button
                    onClick={() => setAssigning(s)}
                    className="rounded-md bg-accent-soft px-2 py-1 text-xs font-medium text-accent hover:opacity-80"
                  >
                    Assign students
                  </button>
                )}
                {s.type === 'optional' && <Badge>optional</Badge>}
                {s.name_practical && <Badge tone="accent">partitioned</Badge>}
                {s.is_protected && <Badge tone="warning">protected</Badge>}
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
                    if (window.confirm(`Delete subject “${s.name}”?`)) remove.mutate(s.id)
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
        <SubjectModal
          subject={editing === 'new' ? null : editing}
          classId={classId}
          nextOrder={rows.length ? Math.max(...rows.map((r) => r.order)) + 1 : 1}
          onClose={() => setEditing(null)}
        />
      )}
      {assigning && (
        <AssignStudentsModal
          subject={assigning}
          classId={classId}
          onClose={() => setAssigning(null)}
        />
      )}
    </div>
  )
}

/** Optional-subject targeting: tick who takes it. Empty selection = the
 *  whole class (compulsory behaviour); marks rosters narrow to this set. */
function AssignStudentsModal({
  subject,
  classId,
  onClose,
}: {
  subject: SubjectFull
  classId: string
  onClose: () => void
}) {
  const toast = useToast()
  const roster = useExamClassRoster(classId)
  const current = useQuery({
    queryKey: ['academics', 'subject-assignments', subject.id],
    queryFn: async () =>
      (
        await api.get<{ students: string[] }>(
          `/api/v1/academics/subjects/${subject.id}/assignments/`,
        )
      ).data.students,
  })
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (current.data) setPicked(new Set(current.data))
  }, [current.data])

  const save = useMutation({
    mutationFn: () =>
      api.put(`/api/v1/academics/subjects/${subject.id}/assignments/`, {
        students: [...picked],
      }),
    onSuccess: () => {
      toast.success(`${subject.name}: ${picked.size} students assigned.`)
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const rows = roster.data ?? []
  return (
    <Modal
      open
      onClose={onClose}
      title={`Who takes ${subject.name}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            Save assignment
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-ink-muted">
        Marks entry for this optional subject lists only the ticked students.
        Ticking nobody keeps the whole class eligible.
      </p>
      <div className="mb-2 flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>
          Select all
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
          Clear
        </Button>
        <span className="ml-auto self-center text-xs text-ink-muted">
          {picked.size}/{rows.length}
        </span>
      </div>
      <div className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1.5">
        {roster.isLoading ? (
          <SkeletonRows rows={5} />
        ) : (
          rows.map((r) => (
            <label
              key={r.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                checked={picked.has(r.id)}
                onChange={(e) => {
                  setPicked((prev) => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(r.id)
                    else next.delete(r.id)
                    return next
                  })
                }}
                className="size-4 accent-accent"
              />
              <span className="flex-1">{r.full_name}</span>
              <span className="text-xs text-ink-faint">Roll {r.roll_no || '—'}</span>
            </label>
          ))
        )}
      </div>
    </Modal>
  )
}

function SubjectModal({
  subject,
  classId,
  nextOrder,
  onClose,
}: {
  subject: SubjectFull | null
  classId: string
  nextOrder: number
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: subject?.name ?? '',
    code: subject?.code ?? '',
    type: subject?.type ?? 'compulsory',
    credit_hours: subject?.credit_hours ?? '',
    order: subject ? String(subject.order) : String(nextOrder),
    name_practical: subject?.name_practical ?? '',
    code_practical: subject?.code_practical ?? '',
    credit_hours_practical: subject?.credit_hours_practical ?? '',
  })
  const [partitioned, setPartitioned] = useState(!!subject?.name_practical)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        class_info: subject?.class_info ?? classId,
        name: form.name.trim(),
        code: form.code,
        type: form.type,
        credit_hours: form.credit_hours,
        order: Number(form.order) || 0,
        name_practical: partitioned ? form.name_practical : '',
        code_practical: partitioned ? form.code_practical : '',
        credit_hours_practical:
          partitioned && form.credit_hours_practical ? form.credit_hours_practical : null,
      }
      return subject
        ? api.patch(`/api/v1/academics/subjects/${subject.id}/`, payload)
        : api.post('/api/v1/academics/subjects/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['academics', 'subjects'] })
      toast.success(subject ? 'Subject updated.' : 'Subject added.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = form.name.trim() && form.credit_hours !== ''

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={subject ? `Edit ${subject.name}` : 'New subject'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {subject ? 'Save changes' : 'Add subject'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={set('name')} autoFocus placeholder="Mathematics" />
          </Field>
          <Field label="Code">
            <Input value={form.code} onChange={set('code')} placeholder="MTH" />
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={set('type')}>
              <option value="compulsory">Compulsory</option>
              <option value="optional">Optional</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Credit hours">
              <Input
                type="number"
                step="0.25"
                min="0"
                value={form.credit_hours}
                onChange={set('credit_hours')}
              />
            </Field>
            <Field label="Order">
              <Input type="number" value={form.order} onChange={set('order')} />
            </Field>
          </div>
        </div>

        <label className="flex min-h-10 items-center gap-2.5 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4 accent-accent-strong"
            checked={partitioned}
            onChange={(e) => setPartitioned(e.target.checked)}
          />
          Has a separate practical part
        </label>

        {partitioned && (
          <div className="grid grid-cols-1 gap-3 rounded-xl bg-surface-sunken p-4 sm:grid-cols-3">
            <Field label="Practical name">
              <Input
                value={form.name_practical}
                onChange={set('name_practical')}
                placeholder="Mathematics (Practical)"
              />
            </Field>
            <Field label="Practical code">
              <Input value={form.code_practical} onChange={set('code_practical')} />
            </Field>
            <Field label="Practical credit hrs">
              <Input
                type="number"
                step="0.25"
                min="0"
                value={form.credit_hours_practical ?? ''}
                onChange={set('credit_hours_practical')}
              />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  )
}
