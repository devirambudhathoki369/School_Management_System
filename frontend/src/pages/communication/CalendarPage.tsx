import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { EVENT_TYPES, useCalendarEvents, type CalendarEventRow } from '../../lib/campus'
import { bsMonthName, formatDateBS } from '../../lib/format'
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
import { IconCalendar, IconPencil, IconPlus, IconTrash } from '../../components/icons'

const TYPE_TONE: Record<string, 'accent' | 'danger' | 'positive' | 'warning' | 'neutral'> = {
  holiday: 'danger',
  exam: 'accent',
  result: 'positive',
  event: 'warning',
  vacation: 'neutral',
}

/** School calendar: holidays, exams, results and event days, month by month. */
export default function CalendarPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const events = useCalendarEvents()
  const [typeFilter, setTypeFilter] = useState('')
  const [editing, setEditing] = useState<CalendarEventRow | 'new' | null>(null)

  const groups = useMemo(() => {
    const rows = (events.data ?? [])
      .filter((e) => !typeFilter || e.event_type === typeFilter)
      .sort((a, b) => b.start_date_bs.localeCompare(a.start_date_bs))
    const byMonth = new Map<string, CalendarEventRow[]>()
    for (const e of rows) {
      const [y, m] = e.start_date_bs.split('-')
      const key = `${bsMonthName(Number(m))} ${y}`
      byMonth.set(key, [...(byMonth.get(key) ?? []), e])
    }
    return [...byMonth.entries()]
  }, [events.data, typeFilter])

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/communication/calendar/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communication', 'calendar'] })
      toast.success('Event removed.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          aria-label="Event type filter"
          className="w-44"
        >
          <option value="">All event types</option>
          {EVENT_TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button onClick={() => setEditing('new')}>
          <IconPlus size={16} /> New event
        </Button>
      </div>

      {events.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={6} />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={<IconCalendar size={22} />}
            title="No calendar entries"
            hint="Add holidays, exams and event days for the school year."
          />
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([month, rows]) => (
            <section key={month}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {month}
              </h3>
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <ul className="divide-y divide-border">
                  {rows.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {e.description ||
                            EVENT_TYPES.find(([v]) => v === e.event_type)?.[1]}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-muted">
                          {formatDateBS(e.start_date_bs)}
                          {e.end_date_bs !== e.start_date_bs &&
                            ` — ${formatDateBS(e.end_date_bs)}`}
                        </p>
                      </div>
                      <Badge tone={TYPE_TONE[e.event_type] ?? 'neutral'}>
                        {EVENT_TYPES.find(([v]) => v === e.event_type)?.[1]}
                      </Badge>
                      <button
                        aria-label="Edit event"
                        onClick={() => setEditing(e)}
                        className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-surface-sunken hover:text-ink"
                      >
                        <IconPencil size={16} />
                      </button>
                      <button
                        aria-label="Delete event"
                        onClick={() => {
                          if (window.confirm('Delete this calendar entry?')) remove.mutate(e.id)
                        }}
                        className="flex size-9 items-center justify-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
                      >
                        <IconTrash size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <EventModal event={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function EventModal({
  event,
  onClose,
}: {
  event: CalendarEventRow | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    event_type: event?.event_type ?? 'holiday',
    start_date_bs: event?.start_date_bs ?? '',
    end_date_bs: event?.end_date_bs ?? '',
    description: event?.description ?? '',
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form, end_date_bs: form.end_date_bs || form.start_date_bs }
      return event
        ? api.patch(`/api/v1/communication/calendar/${event.id}/`, payload)
        : api.post('/api/v1/communication/calendar/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['communication', 'calendar'] })
      toast.success(event ? 'Event updated.' : 'Event added.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <Modal
      open
      onClose={onClose}
      title={event ? 'Edit event' : 'New calendar event'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={save.isPending}
            disabled={!form.start_date_bs}
            onClick={() => save.mutate()}
          >
            {event ? 'Save changes' : 'Add event'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Type">
          <Select value={form.event_type} onChange={set('event_type')}>
            {EVENT_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts (BS)">
            <Input value={form.start_date_bs} onChange={set('start_date_bs')} placeholder="2082-05-15" />
          </Field>
          <Field label="Ends (BS)" hint="Blank = one-day event.">
            <Input value={form.end_date_bs} onChange={set('end_date_bs')} placeholder="2082-05-15" />
          </Field>
        </div>
        <Field label="Description">
          <Input value={form.description} onChange={set('description')} placeholder="Dashain vacation" />
        </Field>
      </div>
    </Modal>
  )
}
