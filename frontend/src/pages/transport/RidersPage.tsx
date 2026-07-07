import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useRiders, useStations, type RiderRow } from '../../lib/campus'
import { useCalendar, type StudentRow } from '../../lib/billing'
import { formatDateBS } from '../../lib/format'
import StudentPicker from '../../components/StudentPicker'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Pagination,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconBus, IconPencil, IconPlus, IconTrash } from '../../components/icons'

/** Who rides from where. A subscription is what makes billing add the
 *  station's monthly fee to the student's invoice. */
export default function RidersPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const stations = useStations()
  const [stationId, setStationId] = useState('')
  const [page, setPage] = useState(1)
  const riders = useRiders(stationId || null, page)
  const [editing, setEditing] = useState<RiderRow | 'new' | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/transport/riders/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport'] })
      toast.success('Rider unsubscribed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={stationId}
          onChange={(e) => {
            setStationId(e.target.value)
            setPage(1)
          }}
          aria-label="Station filter"
          className="w-56"
        >
          <option value="">All stations</option>
          {(stations.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> Subscribe student
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {riders.isLoading ? (
          <SkeletonRows rows={8} />
        ) : (riders.data?.results ?? []).length === 0 ? (
          <EmptyState
            icon={<IconBus size={22} />}
            title="No riders"
            hint="Subscribe students to their pickup stations."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(riders.data?.results ?? []).map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.student_name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {r.station_name ?? 'no station'}
                    {r.start_date_bs && ` · since ${formatDateBS(r.start_date_bs)}`}
                    {r.remarks && ` · ${r.remarks}`}
                  </p>
                </div>
                <button
                  aria-label={`Edit rider ${r.student_name}`}
                  onClick={() => setEditing(r)}
                  className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                >
                  <IconPencil size={16} />
                </button>
                <button
                  aria-label={`Unsubscribe ${r.student_name}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Unsubscribe ${r.student_name}? Their transport fee stops with the next billing run.`,
                      )
                    )
                      remove.mutate(r.id)
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

      {riders.data && (
        <Pagination
          count={riders.data.count}
          page={page}
          pageSize={50}
          onPage={setPage}
          label="riders"
        />
      )}

      {editing && (
        <RiderModal rider={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function RiderModal({ rider, onClose }: { rider: RiderRow | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const stations = useStations()
  const calendar = useCalendar()
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [stationId, setStationId] = useState(rider?.bus_station ?? '')
  const [startDate, setStartDate] = useState(rider?.start_date_bs ?? '')
  const [remarks, setRemarks] = useState(rider?.remarks ?? '')
  const effectiveStart = startDate || (rider ? '' : (calendar.data?.today_bs ?? ''))

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        bus_station: stationId || null,
        start_date_bs: effectiveStart,
        remarks,
      }
      if (rider) return api.patch(`/api/v1/transport/riders/${rider.id}/`, payload)
      return api.post('/api/v1/transport/riders/', { ...payload, student: student!.id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport'] })
      toast.success(rider ? 'Rider updated.' : 'Student subscribed.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = stationId && (rider || student)

  return (
    <Modal
      open
      onClose={onClose}
      title={rider ? `Edit rider — ${rider.student_name}` : 'Subscribe a student'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button busy={save.isPending} disabled={!valid} onClick={() => save.mutate()}>
            {rider ? 'Save changes' : 'Subscribe'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!rider && (
          <Field label="Student">
            <StudentPicker value={student} onChange={setStudent} autoFocus />
          </Field>
        )}
        <Field label="Station">
          <Select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">Choose a station…</option>
            {(stations.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Since (BS)">
            <Input value={effectiveStart} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Remarks">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
