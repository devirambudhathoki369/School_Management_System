import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useNotices, type Notice } from '../../lib/campus'
import { useCalendar } from '../../lib/billing'
import { formatDateBS } from '../../lib/format'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconMegaphone, IconPencil, IconPlus, IconTrash } from '../../components/icons'

/** School notices — push-first announcements with an optional image. */
export default function NoticesPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const { data, isLoading } = useNotices(page)
  const [editing, setEditing] = useState<Notice | 'new' | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/communication/notices/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communication', 'notices'] })
      toast.success('Notice removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New notice
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <SkeletonRows rows={6} />
        ) : (data?.results ?? []).length === 0 ? (
          <EmptyState
            icon={<IconMegaphone size={22} />}
            title="No notices yet"
            hint="Publish announcements parents and students will see."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(data?.results ?? []).map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                {n.image && (
                  <img
                    src={n.image}
                    alt=""
                    className="mt-0.5 size-12 shrink-0 rounded-lg object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">{formatDateBS(n.date_bs)}</p>
                  {n.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{n.description}</p>
                  )}
                </div>
                <button
                  aria-label={`Edit ${n.title}`}
                  onClick={() => setEditing(n)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <button
                  aria-label={`Delete ${n.title}`}
                  onClick={() => {
                    if (window.confirm(`Delete notice “${n.title}”?`)) remove.mutate(n.id)
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

      {data && (
        <Pagination count={data.count} page={page} pageSize={50} onPage={setPage} label="notices" />
      )}

      {editing && (
        <NoticeModal notice={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function NoticeModal({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const calendar = useCalendar()
  const [title, setTitle] = useState(notice?.title ?? '')
  const [description, setDescription] = useState(notice?.description ?? '')
  const [dateBs, setDateBs] = useState(notice?.date_bs ?? '')
  const fileRef = useRef<HTMLInputElement>(null)
  const effectiveDate = dateBs || calendar.data?.today_bs || ''

  const save = useMutation({
    mutationFn: () => {
      // multipart so the optional image rides along
      const form = new FormData()
      form.append('title', title.trim())
      form.append('description', description)
      form.append('date_bs', effectiveDate)
      const file = fileRef.current?.files?.[0]
      if (file) form.append('image', file)
      const config = { headers: { 'Content-Type': 'multipart/form-data' } }
      return notice
        ? api.patch(`/api/v1/communication/notices/${notice.id}/`, form, config)
        : api.post('/api/v1/communication/notices/', form, config)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communication', 'notices'] })
      toast.success(notice ? 'Notice updated.' : 'Notice published.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={notice ? 'Edit notice' : 'New notice'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={!title.trim() || !effectiveDate}
            onClick={() => save.mutate()}
          >
            {notice ? 'Save changes' : 'Publish notice'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-shadow placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date (BS)">
            <Input
              value={effectiveDate}
              onChange={(e) => setDateBs(e.target.value)}
              placeholder="2082-03-21"
            />
          </Field>
          <Field label="Image" hint={notice?.image ? 'Choosing a file replaces the current image.' : 'Optional.'}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="block w-full text-sm text-ink-muted file:mr-3 file:h-10 file:cursor-pointer file:rounded-lg file:border-0 file:bg-surface-sunken file:px-4 file:text-sm file:font-medium file:text-ink"
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
