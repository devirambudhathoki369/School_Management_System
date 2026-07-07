import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import {
  useHomeworkDetail,
  useHomeworkList,
  useHomeworkStaff,
  type HomeworkRow,
} from '../../lib/campus'
import { useClassSubjects } from '../../lib/exams'
import { useCalendar } from '../../lib/billing'
import { formatDateBS } from '../../lib/format'
import ClassPicker from '../../components/ClassPicker'
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
import {
  IconNotebook,
  IconPaperclip,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from '../../components/icons'

/**
 * Homework per class, newest due date first. Teachers post to their own
 * name; admins pick the teacher. Attachments upload after save (the row
 * must exist to hang files on).
 */
export default function HomeworkPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [classId, setClassId] = useState('')
  const list = useHomeworkList(classId || null)
  const [editing, setEditing] = useState<HomeworkRow | 'new' | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/homework/assignments/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] })
      toast.success('Homework removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-4 rounded-xl border border-border bg-surface p-4">
        <ClassPicker classId={classId} onChange={(id) => setClassId(id)} />
      </div>

      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing('new')} disabled={!classId}>
          <IconPlus size={16} /> Assign homework
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {list.isLoading && classId ? (
          <SkeletonRows rows={6} />
        ) : (list.data ?? []).length === 0 ? (
          <EmptyState
            icon={<IconNotebook size={22} />}
            title={classId ? 'No homework for this class' : 'Pick a class'}
            hint={classId ? 'Assignments appear here, newest due date first.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-border">
            {(list.data ?? []).map((h) => (
              <li key={h.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{h.title}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {h.subject_name} · {h.staff_name} · due {formatDateBS(h.due_date_bs)}
                  </p>
                  {h.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{h.description}</p>
                  )}
                </div>
                <button
                  aria-label={`Edit ${h.title}`}
                  onClick={() => setEditing(h)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <button
                  aria-label={`Delete ${h.title}`}
                  onClick={() => {
                    if (window.confirm(`Delete homework “${h.title}”?`)) remove.mutate(h.id)
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
        <HomeworkModal
          homework={editing === 'new' ? null : editing}
          classId={classId}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function HomeworkModal({
  homework,
  classId,
  onClose,
}: {
  homework: HomeworkRow | null
  classId: string
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { account } = useAuth()
  const isAdmin = account?.role === 'admin'
  const targetClass = homework?.class_info ?? classId
  const subjects = useClassSubjects(targetClass)
  const staffList = useHomeworkStaff()
  const calendar = useCalendar()
  const detail = useHomeworkDetail(homework?.id ?? null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [title, setTitle] = useState(homework?.title ?? '')
  const [description, setDescription] = useState(homework?.description ?? '')
  const [subject, setSubject] = useState(homework?.subject ?? '')
  const [staff, setStaff] = useState(homework?.staff ?? '')
  const [dueDate, setDueDate] = useState(homework?.due_date_bs ?? '')
  const effectiveDue = dueDate || calendar.data?.today_bs || ''

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description,
        due_date_bs: effectiveDue,
        class_info: targetClass,
        subject,
      }
      if (staff) payload.staff = staff
      if (homework) {
        return (await api.patch<HomeworkRow>(`/api/v1/homework/assignments/${homework.id}/`, payload)).data
      }
      return (await api.post<HomeworkRow>('/api/v1/homework/assignments/', payload)).data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] })
      toast.success(homework ? 'Homework updated.' : 'Homework assigned.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const upload = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0]
      if (!file || !homework) return
      const form = new FormData()
      form.append('file', file)
      await api.post(`/api/v1/homework/assignments/${homework.id}/attachments/`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] })
      if (fileRef.current) fileRef.current.value = ''
      toast.success('File attached.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const detach = useMutation({
    mutationFn: (attachmentId: string) =>
      api.delete(`/api/v1/homework/assignments/${homework!.id}/attachments/${attachmentId}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] })
      toast.success('Attachment removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = title.trim() && subject && effectiveDue && (!isAdmin || staff || homework)

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={homework ? `Edit ${homework.title}` : 'Assign homework'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {homework ? 'Save changes' : 'Assign'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Instructions">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-shadow placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Subject">
            <Select value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">{subjects.isLoading ? 'Loading…' : 'Choose…'}</option>
              {(subjects.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due date (BS)">
            <Input value={effectiveDue} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
          <Field
            label="Teacher"
            hint={isAdmin ? undefined : 'Defaults to you when left blank.'}
          >
            <Select value={staff} onChange={(e) => setStaff(e.target.value)}>
              <option value="">{isAdmin ? 'Choose…' : 'Me'}</option>
              {(staffList.data ?? [])
                .filter((s) => s.status === 'employed' || s.id === staff)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>

        {homework && (
          <section className="rounded-xl bg-surface-sunken p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Attachments
            </h3>
            <ul className="space-y-1.5">
              {(detail.data?.attachments ?? []).map((a) => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <IconPaperclip size={14} className="shrink-0 text-ink-faint" />
                  <a
                    href={a.file}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-accent-strong hover:underline"
                  >
                    {a.file.split('/').pop()}
                  </a>
                  <button
                    aria-label="Remove attachment"
                    onClick={() => detach.mutate(a.id)}
                    className="flex size-7 items-center justify-center rounded-md text-ink-faint hover:bg-danger-soft hover:text-danger"
                  >
                    <IconX size={14} />
                  </button>
                </li>
              ))}
              {(detail.data?.attachments ?? []).length === 0 && (
                <li className="text-sm text-ink-muted">No files attached.</li>
              )}
            </ul>
            <div className="mt-3 flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                className="block w-full text-sm text-ink-muted file:mr-3 file:h-9 file:cursor-pointer file:rounded-lg file:border-0 file:bg-surface file:px-3 file:text-sm file:font-medium file:text-ink"
              />
              <Button variant="secondary" busy={upload.isPending} onClick={() => upload.mutate()}>
                Attach
              </Button>
            </div>
          </section>
        )}
        {!homework && (
          <p className="text-xs text-ink-faint">
            Save first, then reopen to attach worksheets or files.
          </p>
        )}
      </div>
    </Modal>
  )
}
