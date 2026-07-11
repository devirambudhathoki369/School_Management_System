import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useClasses } from '../../lib/billing'
import {
  SEAT_ORDER_LABEL,
  useEligibleSeatClasses,
  useExams,
  useSeatRooms,
  type SeatOrderBy,
  type SeatRoom,
} from '../../lib/exams'
import { PrintMirror } from '../billing/ReceiptSheet'
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
  IconArmchair,
  IconPencil,
  IconPlus,
  IconPrinter,
  IconTrash,
} from '../../components/icons'

/**
 * Exam seat plan: rooms are bench × seat grids with each bench column pinned
 * to one class, so neighbours always come from different classes (invariant
 * E3 — anti-cheating by construction). Generation deals each class from one
 * queue across rooms in order, so overflow flows into the next room; anyone
 * left standing is reported. Prints: the seat chart and per-room invigilator
 * attendance sheets.
 */
export default function SeatPlanPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const exams = useExams()
  const [examId, setExamId] = useState('')
  const [editing, setEditing] = useState<SeatRoom | 'new' | null>(null)
  const [shuffle, setShuffle] = useState(false)
  const [unseated, setUnseated] = useState(0)
  const [printMode, setPrintMode] = useState<'chart' | 'sheets'>('chart')

  const exam = (exams.data ?? []).find((e) => e.id === examId) ?? null
  const rooms = useSeatRooms(examId || null)
  const eligible = useEligibleSeatClasses(examId || null)
  const classes = useClasses(exam ? [exam.academic_year] : [])

  const classLabel = useMemo(() => {
    const map = new Map((classes.data ?? []).map((c) => [c.id, c.label]))
    return (id: string) => map.get(id) ?? '—'
  }, [classes.data])

  const generate = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ seated: number; unseated: number }>(
          '/api/v1/examinations/seat-plan-rooms/generate/',
          { exam: examId, shuffle },
        )
      ).data,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'seat-rooms'] })
      setUnseated(data.unseated)
      toast.success(
        `Seated ${data.seated} student${data.seated === 1 ? '' : 's'}` +
          (data.unseated ? ` — ${data.unseated} without a seat.` : '.'),
      )
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (roomId: string) =>
      api.delete(`/api/v1/examinations/seat-plan-rooms/${roomId}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'seat-rooms'] })
      toast.success('Room deleted.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const roomList = rooms.data ?? []
  const seated = roomList.reduce((n, room) => n + room.allocations.length, 0)
  const capacity = roomList.reduce((n, room) => n + room.capacity, 0)
  const anySeated = seated > 0

  function printAs(mode: 'chart' | 'sheets') {
    setPrintMode(mode)
    // let the mirror re-render with the chosen sheet before printing
    setTimeout(() => window.print(), 30)
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={examId}
          onChange={(e) => {
            setExamId(e.target.value)
            setUnseated(0)
          }}
          aria-label="Exam"
          className="sm:w-72"
        >
          <option value="">{exams.isLoading ? 'Loading exams…' : 'Choose an exam…'}</option>
          {(exams.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
        {examId && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <Button variant="secondary" onClick={() => setEditing('new')}>
              <IconPlus size={16} /> Add room
            </Button>
            <Button
              disabled={roomList.length === 0 || generate.isPending}
              onClick={() => generate.mutate()}
            >
              {generate.isPending ? 'Arranging…' : 'Generate seating'}
            </Button>
          </div>
        )}
      </div>

      {!examId ? (
        <EmptyState
          icon={<IconArmchair size={22} />}
          title="Pick an exam"
          hint="Add rooms, pin a class to each bench column, then generate the seating."
        />
      ) : rooms.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={6} />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-ink-muted">
              <span className="font-semibold text-ink">{roomList.length}</span> room
              {roomList.length === 1 ? '' : 's'} ·{' '}
              <span className="font-semibold text-ink">{capacity}</span> seats ·{' '}
              <span className="font-semibold text-ink">{seated}</span> seated
            </span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={shuffle}
                onChange={(e) => setShuffle(e.target.checked)}
                className="size-4 accent-accent"
              />
              Shuffle students within classes
            </label>
            {anySeated && (
              <span className="flex gap-2 sm:ml-auto">
                <Button variant="secondary" onClick={() => printAs('chart')}>
                  <IconPrinter size={16} /> Seat chart
                </Button>
                <Button variant="secondary" onClick={() => printAs('sheets')}>
                  <IconPrinter size={16} /> Attendance sheets
                </Button>
              </span>
            )}
          </div>

          {unseated > 0 && (
            <p className="mb-4 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              <strong>{unseated}</strong> student{unseated === 1 ? '' : 's'} could not be
              seated — add a room or more benches, then regenerate.
            </p>
          )}

          {roomList.length === 0 ? (
            <EmptyState
              icon={<IconArmchair size={22} />}
              title="No rooms yet"
              hint="Add the first room — benches × seats, one class per bench side."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {roomList.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  classLabel={classLabel}
                  onEdit={() => setEditing(room)}
                  onDelete={() => {
                    if (window.confirm(`Delete ${room.name} and its seating?`)) {
                      remove.mutate(room.id)
                    }
                  }}
                />
              ))}
            </div>
          )}

          <PrintMirror>
            {printMode === 'chart' ? (
              <SeatChartPrint rooms={roomList} examName={exam?.name ?? ''} classLabel={classLabel} />
            ) : (
              <AttendanceSheetsPrint
                rooms={roomList}
                examName={exam?.name ?? ''}
                classLabel={classLabel}
              />
            )}
          </PrintMirror>
        </>
      )}

      {editing && examId && (
        <RoomModal
          examId={examId}
          room={editing === 'new' ? null : editing}
          eligible={eligible.data ?? []}
          classes={(classes.data ?? []).map((c) => ({ id: c.id, label: c.label }))}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RoomCard({
  room,
  classLabel,
  onEdit,
  onDelete,
}: {
  room: SeatRoom
  classLabel: (id: string) => string
  onEdit: () => void
  onDelete: () => void
}) {
  const byBench = useMemo(() => {
    const map = new Map<number, Map<number, SeatRoom['allocations'][number]>>()
    for (const a of room.allocations) {
      if (!map.has(a.bench_no)) map.set(a.bench_no, new Map())
      map.get(a.bench_no)!.set(a.column, a)
    }
    return map
  }, [room.allocations])

  const columns = Array.from({ length: room.seats_per_bench }, (_, i) => i + 1)
  const columnClass = new Map(room.classes.map((c) => [c.column, c.class_info]))

  return (
    <section className="rounded-xl border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{room.name}</h2>
          <p className="text-xs text-ink-muted">
            {room.benches} benches × {room.seats_per_bench} · {room.capacity} seats ·{' '}
            {room.allocations.length} seated · ordered by{' '}
            {SEAT_ORDER_LABEL[room.order_by].toLowerCase()}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onEdit}
            aria-label={`Edit ${room.name}`}
            className="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            <IconPencil size={16} />
          </button>
          <button
            onClick={onDelete}
            aria-label={`Delete ${room.name}`}
            className="flex size-9 items-center justify-center rounded-lg text-ink-muted hover:bg-danger-soft hover:text-danger"
          >
            <IconTrash size={16} />
          </button>
        </div>
      </header>

      <div className="overflow-x-auto px-4 py-3">
        <div className="w-max min-w-full">
          <div
            className="mb-1 grid gap-2"
            style={{ gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(10rem, 1fr))` }}
          >
            <span />
            {columns.map((col) => (
              <span key={col} className="text-xs font-medium text-ink-muted">
                Side {col}
                {columnClass.has(col) && (
                  <span className="ml-1 text-ink">— {classLabel(columnClass.get(col)!)}</span>
                )}
              </span>
            ))}
          </div>
          {room.allocations.length === 0 ? (
            <p className="py-2 text-sm italic text-ink-faint">
              Not arranged yet — generate the seating.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: room.benches }, (_, i) => i + 1).map((bench) => (
                <div
                  key={bench}
                  className="grid items-stretch gap-2"
                  style={{
                    gridTemplateColumns: `3.5rem repeat(${columns.length}, minmax(10rem, 1fr))`,
                  }}
                >
                  <span className="flex items-center text-xs font-medium text-ink-faint">
                    B{bench}
                  </span>
                  {columns.map((col) => {
                    const seat = byBench.get(bench)?.get(col)
                    return seat ? (
                      <span
                        key={col}
                        className="truncate rounded-lg bg-accent-soft px-2.5 py-1.5 text-sm"
                      >
                        <span className="font-medium capitalize">{seat.name}</span>
                        <span className="ml-1 text-xs text-ink-muted">
                          {seat.roll_no && `R${seat.roll_no}`}
                          {seat.symbol_no && ` · S${seat.symbol_no}`}
                        </span>
                      </span>
                    ) : (
                      <span
                        key={col}
                        className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-sm text-ink-faint"
                      >
                        —
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {room.note && <p className="border-t border-border px-4 py-2 text-xs text-ink-muted">{room.note}</p>}
    </section>
  )
}

function RoomModal({
  examId,
  room,
  eligible,
  classes,
  onClose,
}: {
  examId: string
  room: SeatRoom | null
  eligible: string[]
  classes: Array<{ id: string; label: string }>
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(room?.name ?? '')
  const [benches, setBenches] = useState(String(room?.benches ?? 10))
  const [seats, setSeats] = useState(String(room?.seats_per_bench ?? 2))
  const [orderBy, setOrderBy] = useState<SeatOrderBy>(room?.order_by ?? 'roll')
  const [note, setNote] = useState(room?.note ?? '')
  const [columnClasses, setColumnClasses] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {}
    room?.classes.forEach((c) => {
      initial[c.column] = c.class_info
    })
    return initial
  })

  // Only offer classes the exam's education level covers; when the exam
  // isn't tied to any class yet, everything is on the table.
  const options = eligible.length > 0 ? classes.filter((c) => eligible.includes(c.id)) : classes
  const seatCount = Math.max(1, Math.min(6, Number(seats) || 1))

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        exam: examId,
        name: name.trim(),
        benches: Number(benches) || 1,
        seats_per_bench: seatCount,
        order_by: orderBy,
        note: note.trim(),
        classes: Array.from({ length: seatCount }, (_, i) => i + 1)
          .filter((col) => columnClasses[col])
          .map((col) => ({ class_info: columnClasses[col], column: col, order_by: '' })),
      }
      return room
        ? api.patch(`/api/v1/examinations/seat-plan-rooms/${room.id}/`, payload)
        : api.post('/api/v1/examinations/seat-plan-rooms/', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams', 'seat-rooms'] })
      toast.success(room ? 'Room updated — regenerate the seating.' : 'Room added.')
      onClose()
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const valid = name.trim().length > 0 && Object.values(columnClasses).some(Boolean)

  return (
    <Modal open title={room ? `Edit ${room.name}` : 'Add room'} onClose={onClose}>
      <div className="grid gap-3">
        <Field label="Room name / number">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Room 101" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Benches">
            <Input
              value={benches}
              onChange={(e) => setBenches(e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field label="Students per bench">
            <Input value={seats} onChange={(e) => setSeats(e.target.value)} inputMode="numeric" />
          </Field>
        </div>
        <Field label="Order students by">
          <Select value={orderBy} onChange={(e) => setOrderBy(e.target.value as SeatOrderBy)}>
            {Object.entries(SEAT_ORDER_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {Array.from({ length: seatCount }, (_, i) => i + 1).map((col) => (
          <Field key={col} label={`Side ${col} — class`}>
            <Select
              value={columnClasses[col] ?? ''}
              onChange={(e) =>
                setColumnClasses((cc) => ({ ...cc, [col]: e.target.value }))
              }
            >
              <option value="">Leave empty</option>
              {options.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        ))}
        <Field label="Note (optional)">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Shown on the printed chart"
          />
        </Field>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : room ? 'Update room' : 'Add room'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ prints

function PrintHeader({ examName, title }: { examName: string; title: string }) {
  const { account } = useAuth()
  const school = account?.school
  return (
    <header className="mb-3 text-center">
      <h1 className="text-lg font-bold uppercase tracking-wide">{school?.name}</h1>
      {school?.address && <p className="text-sm">{school.address}</p>}
      <p className="mt-1 font-semibold">
        {title} — {examName}
      </p>
    </header>
  )
}

function SeatChartPrint({
  rooms,
  examName,
  classLabel,
}: {
  rooms: SeatRoom[]
  examName: string
  classLabel: (id: string) => string
}) {
  return (
    <div className="bg-white p-8 text-sm text-black">
      <PrintHeader examName={examName} title="Seat plan" />
      {rooms.map((room) => {
        const byBench = new Map<number, Map<number, SeatRoom['allocations'][number]>>()
        for (const a of room.allocations) {
          if (!byBench.has(a.bench_no)) byBench.set(a.bench_no, new Map())
          byBench.get(a.bench_no)!.set(a.column, a)
        }
        const columns = Array.from({ length: room.seats_per_bench }, (_, i) => i + 1)
        if (room.allocations.length === 0) return null
        return (
          <section key={room.id} className="mb-6 break-inside-avoid">
            <h2 className="mb-1 font-bold">
              {room.name}
              <span className="ml-2 text-xs font-normal">
                {room.classes
                  .map((c) => `Side ${c.column}: ${classLabel(c.class_info)}`)
                  .join(' · ')}
              </span>
            </h2>
            <table className="w-full border-collapse text-xs [&_td]:border [&_th]:border [&_td]:border-black/50 [&_th]:border-black/50 [&_td]:px-1.5 [&_td]:py-1 [&_th]:px-1.5 [&_th]:py-1">
              <thead>
                <tr>
                  <th className="w-12">Bench</th>
                  {columns.map((col) => (
                    <th key={col}>Side {col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: room.benches }, (_, i) => i + 1).map((bench) => (
                  <tr key={bench}>
                    <td className="text-center font-semibold">{bench}</td>
                    {columns.map((col) => {
                      const seat = byBench.get(bench)?.get(col)
                      return (
                        <td key={col}>
                          {seat ? (
                            <>
                              <span className="font-medium capitalize">{seat.name}</span>
                              <span className="ml-1">
                                {seat.roll_no && `(R ${seat.roll_no}`}
                                {seat.symbol_no && ` · S ${seat.symbol_no}`}
                                {seat.roll_no && ')'}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {room.note && <p className="mt-1 text-xs">{room.note}</p>}
          </section>
        )
      })}
    </div>
  )
}

function AttendanceSheetsPrint({
  rooms,
  examName,
  classLabel,
}: {
  rooms: SeatRoom[]
  examName: string
  classLabel: (id: string) => string
}) {
  return (
    <div className="bg-white p-8 text-sm text-black">
      {rooms.map((room) => {
        if (room.allocations.length === 0) return null
        const ordered = [...room.allocations].sort((a, b) => a.sequence - b.sequence)
        return (
          <section key={room.id} className="break-after-page">
            <PrintHeader examName={examName} title="Invigilator attendance sheet" />
            <p className="mb-2 text-center font-semibold">
              {room.name} — {ordered.length} student{ordered.length === 1 ? '' : 's'}
            </p>
            <table className="w-full border-collapse text-xs [&_td]:border [&_th]:border [&_td]:border-black/50 [&_th]:border-black/50 [&_td]:px-1.5 [&_td]:py-1.5 [&_th]:px-1.5 [&_th]:py-1">
              <thead>
                <tr className="text-left">
                  <th className="w-8">S.N</th>
                  <th>Symbol no.</th>
                  <th>Roll</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Seat</th>
                  <th className="w-32">Signature</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((seat, index) => (
                  <tr key={seat.id}>
                    <td>{index + 1}</td>
                    <td className="tabular-nums">{seat.symbol_no || ''}</td>
                    <td className="tabular-nums">{seat.roll_no || ''}</td>
                    <td className="capitalize">{seat.name}</td>
                    <td>{classLabel(seat.class_info)}</td>
                    <td>
                      B{seat.bench_no} / S{seat.column}
                    </td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      })}
    </div>
  )
}
