import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Paginated } from '../../lib/billing'
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

/** News & events — longer-form posts shown in the app feed. */

interface NewsPost {
  id: string
  title: string
  content: string
  images: Array<{ id: string; image: string }>
}

function useNews(page: number) {
  return useQuery({
    queryKey: ['communication', 'news', page],
    queryFn: async () =>
      (
        await api.get<Paginated<NewsPost>>('/api/v1/communication/news/', {
          params: { page },
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

export default function NewsPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const { data, isLoading } = useNews(page)
  const [editing, setEditing] = useState<NewsPost | 'new' | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/communication/news/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communication', 'news'] })
      toast.success('Post removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New post
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <SkeletonRows rows={6} />
        ) : (data?.results ?? []).length === 0 ? (
          <EmptyState
            icon={<IconMegaphone size={22} />}
            title="No news yet"
            hint="Share school events and stories with families."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(data?.results ?? []).map((post) => (
              <li key={post.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                {post.images[0] && (
                  <img
                    src={post.images[0].image}
                    alt=""
                    className="mt-0.5 size-12 shrink-0 rounded-lg object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{post.title}</p>
                  {post.content && (
                    <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{post.content}</p>
                  )}
                </div>
                <button
                  aria-label={`Edit ${post.title}`}
                  onClick={() => setEditing(post)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <button
                  aria-label={`Delete ${post.title}`}
                  onClick={() => {
                    if (window.confirm(`Delete “${post.title}”?`)) remove.mutate(post.id)
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
        <div className="mt-3">
          <Pagination count={data.count} page={page} pageSize={50} onPage={setPage} label="posts" />
        </div>
      )}

      {editing && (
        <NewsModal post={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function NewsModal({ post, onClose }: { post: NewsPost | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(post?.title ?? '')
  const [content, setContent] = useState(post?.content ?? '')

  const save = useMutation({
    mutationFn: () =>
      post
        ? api.patch(`/api/v1/communication/news/${post.id}/`, { title, content })
        : api.post('/api/v1/communication/news/', { title, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communication', 'news'] })
      toast.success(post ? 'Post updated.' : 'Post published.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={post ? 'Edit post' : 'New post'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!title.trim()} onClick={() => save.mutate()}>
            {post ? 'Save changes' : 'Publish'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Content">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-shadow placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent-soft"
          />
        </Field>
      </div>
    </Modal>
  )
}
