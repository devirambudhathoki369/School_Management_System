import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useStations, type StationRow } from '../../lib/campus'
import { formatMoneyRs } from '../../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconBus, IconPencil, IconPlus, IconTrash } from '../../components/icons'

/**
 * Bus stations with their monthly fee — billing resolves each rider's
 * transport line ('tn') from the station fee, so this list IS the transport
 * price sheet. Stations with riders cannot be deleted (X2, server-enforced).
 */
export default function StationsPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const stations = useStations()
  const [editing, setEditing] = useState<StationRow | 'new' | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/transport/stations/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport'] })
      toast.success('Station removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New station
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {stations.isLoading ? (
          <SkeletonRows rows={6} />
        ) : (stations.data ?? []).length === 0 ? (
          <EmptyState
            icon={<IconBus size={22} />}
            title="No stations yet"
            hint="Add pickup points and their monthly transport fee."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(stations.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.name}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {formatMoneyRs(s.fee)} / month
                  </p>
                </div>
                <Badge tone={s.rider_count > 0 ? 'accent' : 'neutral'}>
                  {s.rider_count} rider{s.rider_count === 1 ? '' : 's'}
                </Badge>
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
                    if (window.confirm(`Delete station “${s.name}”?`)) remove.mutate(s.id)
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
        <StationModal
          station={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function StationModal({
  station,
  onClose,
}: {
  station: StationRow | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: station?.name ?? '',
    fee: station?.fee ?? '',
    latitude: station?.latitude ?? '',
    longitude: station?.longitude ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        fee: form.fee || '0',
        latitude: form.latitude || null,
        longitude: form.longitude || null,
      }
      return station
        ? api.patch(`/api/v1/transport/stations/${station.id}/`, payload)
        : api.post('/api/v1/transport/stations/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport'] })
      toast.success(station ? 'Station updated.' : 'Station added.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={station ? `Edit ${station.name}` : 'New station'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>
            {station ? 'Save changes' : 'Add station'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={form.name} onChange={set('name')} autoFocus placeholder="Tulsipur chowk" />
        </Field>
        <Field label="Monthly fee" hint="Billing charges each rider this amount as the transport line.">
          <Input type="number" step="0.01" min="0" value={form.fee} onChange={set('fee')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude">
            <Input value={form.latitude ?? ''} onChange={set('latitude')} placeholder="Optional" />
          </Field>
          <Field label="Longitude">
            <Input value={form.longitude ?? ''} onChange={set('longitude')} placeholder="Optional" />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
