import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { fetchAllPages, type StudentRow } from '../../lib/billing'
import StudentPicker from '../../components/StudentPicker'
import {
  Button,
  EmptyState,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconScan, IconTrash } from '../../components/icons'

/**
 * Photo pool (legacy Match Photos): the photographer's memory card lands
 * here in one upload; office staff pair each shot to a student later.
 * Pairing writes the student photo and removes the pool row — staging,
 * never an archive.
 */

interface PendingPhoto {
  id: string
  image: string
  note: string
  created_at: string
}

export default function PhotoPoolPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const pool = useQuery({
    queryKey: ['people', 'pending-photos'],
    queryFn: () => fetchAllPages<PendingPhoto>('/api/v1/people/pending-photos/'),
  })

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const form = new FormData()
      for (const file of files) form.append('photos', file)
      return (
        await api.post<{ uploaded: number; rejected: string[] }>(
          '/api/v1/people/pending-photos/',
          form,
        )
      ).data
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['people', 'pending-photos'] })
      toast.success(
        `${res.uploaded} photos pooled` +
          (res.rejected.length ? `; ${res.rejected.length} rejected (not images).` : '.'),
      )
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const rows = pool.data ?? []
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-base font-semibold">Photo pool</h2>
          <p className="text-xs text-ink-muted">
            Upload a whole batch, then pair each shot to its student.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            // FileList is LIVE — clearing the input empties it before the
            // async mutation reads it, so snapshot into a real array first.
            if (e.target.files?.length) upload.mutate(Array.from(e.target.files))
            e.target.value = ''
          }}
        />
        <Button
          className="ml-auto"
          busy={upload.isPending}
          onClick={() => inputRef.current?.click()}
        >
          <IconScan size={16} /> Upload photos
        </Button>
      </div>

      {pool.isLoading ? (
        <SkeletonRows rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconScan size={22} />}
          title="Pool is empty"
          hint="Photos wait here until they're paired to students."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((photo) => (
            <PoolCard key={photo.id} photo={photo} />
          ))}
        </div>
      )}
    </div>
  )
}

function PoolCard({ photo }: { photo: PendingPhoto }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [student, setStudent] = useState<StudentRow | null>(null)

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['people', 'pending-photos'] })

  const pair = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/api/v1/people/pending-photos/${photo.id}/pair/`, {
          student: student!.id,
        })
      ).data,
    onSuccess: () => {
      toast.success(`Photo paired to ${student?.full_name}.`)
      refresh()
      queryClient.invalidateQueries({ queryKey: ['people'] })
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const discard = useMutation({
    mutationFn: () => api.delete(`/api/v1/people/pending-photos/${photo.id}/`),
    onSuccess: refresh,
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <img src={photo.image} alt={photo.note || 'Pool photo'} className="h-48 w-full object-cover" />
      <div className="space-y-2 p-3">
        {photo.note && <p className="truncate text-xs text-ink-faint">{photo.note}</p>}
        <StudentPicker value={student} onChange={setStudent} placeholder="Pair with…" />
        <div className="flex gap-2">
          <Button
            className="flex-1"
            busy={pair.isPending}
            disabled={!student}
            onClick={() => pair.mutate()}
          >
            Pair photo
          </Button>
          <Button
            variant="ghost"
            aria-label="Discard photo"
            onClick={() => {
              if (window.confirm('Discard this photo?')) discard.mutate()
            }}
          >
            <IconTrash size={15} />
          </Button>
        </div>
      </div>
    </div>
  )
}
