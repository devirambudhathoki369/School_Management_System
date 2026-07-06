import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useCalendar, useClasses, useYearPointers } from '../../lib/billing'
import { useClassRoster, useSession, type AttendanceSession } from '../../lib/attendance'
import { formatDateBS } from '../../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Select,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconCheck, IconStudents, IconX } from '../../components/icons'

/**
 * Daily register: pick the class, tap names to flip present/absent, save.
 * Optimised for a teacher on a phone between periods — whole rows are tap
 * targets, everyone starts present, and one save writes the day. A session
 * is unique per (class, BS day); it is created on first save.
 */

interface DraftRow {
  student: string
  name: string
  roll: string
  present: boolean
  reason: string
}

export default function MarkClassPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const calendar = useCalendar()
  const pointers = useYearPointers()
  const runningYears = useMemo(
    () => [...new Set((pointers.data ?? []).map((p) => p.academic_year))],
    [pointers.data],
  )
  const classes = useClasses(runningYears)

  const [classId, setClassId] = useState('')
  const [dateBs, setDateBs] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([])
  const [dirty, setDirty] = useState(false)

  const date = dateBs || calendar.data?.today_bs || ''
  const roster = useClassRoster(classId || null)
  const session = useSession(classId || null, date || null)

  // Roster ∪ existing records → the register. Everyone unmarked starts
  // present (the common case; a teacher only flips the absentees).
  useEffect(() => {
    if (!roster.data || session.isLoading || dirty) return
    const marked = new Map(
      (session.data?.records ?? []).map((r) => [r.student, r]),
    )
    setRows(
      roster.data.map((s) => {
        const record = marked.get(s.id)
        return {
          student: s.id,
          name: s.full_name,
          roll: s.roll_no,
          present: record?.present ?? true,
          reason: record?.reason ?? '',
        }
      }),
    )
  }, [roster.data, session.data, session.isLoading, dirty])

  const absentees = rows.filter((r) => !r.present)

  const save = useMutation({
    mutationFn: async () => {
      let sessionId = session.data?.id
      if (!sessionId) {
        const { data } = await api.post<AttendanceSession>('/api/v1/attendance/sessions/', {
          class_info: classId,
          date_bs: date,
        })
        sessionId = data.id
      }
      await api.put(`/api/v1/attendance/sessions/${sessionId}/mark/`, {
        marks: rows.map((r) => ({
          student: r.student,
          present: r.present,
          reason: r.present ? '' : r.reason,
        })),
      })
    },
    onSuccess: () => {
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      queryClient.invalidateQueries({ queryKey: ['reports', 'dashboard'] })
      toast.success(
        absentees.length === 0
          ? 'Attendance saved — full house today.'
          : `Attendance saved — ${absentees.length} absent.`,
      )
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  function toggle(student: string) {
    setDirty(true)
    setRows((rs) =>
      rs.map((r) => (r.student === student ? { ...r, present: !r.present } : r)),
    )
  }

  return (
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px_auto]">
        <Select
          value={classId}
          onChange={(e) => {
            setClassId(e.target.value)
            setDirty(false)
          }}
          aria-label="Class"
        >
          <option value="">
            {classes.isError
              ? 'Classes unavailable (needs the academics permission)'
              : 'Choose a class…'}
          </option>
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <Input
          value={date}
          onChange={(e) => {
            setDateBs(e.target.value)
            setDirty(false)
          }}
          aria-label="Date (BS)"
          placeholder="2083-03-22"
        />
        {rows.length > 0 && (
          <Button
            variant="secondary"
            onClick={() => {
              setDirty(true)
              setRows((rs) => rs.map((r) => ({ ...r, present: true, reason: '' })))
            }}
          >
            <IconCheck size={15} /> All present
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {!classId ? (
          <EmptyState
            icon={<IconStudents size={22} />}
            title="Pick a class"
            hint="Tap a student to flip present/absent — everyone starts present."
          />
        ) : roster.isLoading || session.isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState title="No running students in this class" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.student}>
                <div
                  className={`flex items-center gap-3 px-4 py-2.5 sm:px-5 ${
                    row.present ? '' : 'bg-danger-soft/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(row.student)}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left"
                    aria-pressed={!row.present}
                    aria-label={`${row.name}: mark ${row.present ? 'absent' : 'present'}`}
                  >
                    <span
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-white ${
                        row.present ? 'bg-positive' : 'bg-danger'
                      }`}
                    >
                      {row.present ? <IconCheck size={16} /> : <IconX size={16} />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{row.name}</span>
                      {row.roll && (
                        <span className="block text-xs text-ink-muted">Roll {row.roll}</span>
                      )}
                    </span>
                  </button>
                  {!row.present && (
                    <Input
                      value={row.reason}
                      placeholder="Reason (optional)"
                      aria-label={`${row.name} absence reason`}
                      className="h-9 w-40 sm:w-56"
                      onChange={(e) => {
                        setDirty(true)
                        setRows((rs) =>
                          rs.map((r) =>
                            r.student === row.student ? { ...r, reason: e.target.value } : r,
                          ),
                        )
                      }}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rows.length > 0 && (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg sm:px-5">
          <p className="text-sm">
            {formatDateBS(date)} ·{' '}
            <span className="font-semibold text-positive">{rows.length - absentees.length} present</span>
            {absentees.length > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-danger">{absentees.length} absent</span>
              </>
            )}
            {session.data && (
              <span className="ml-2 align-middle">
                <Badge tone="accent">already marked — editing</Badge>
              </span>
            )}
          </p>
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            Save attendance
          </Button>
        </div>
      )}
    </div>
  )
}
