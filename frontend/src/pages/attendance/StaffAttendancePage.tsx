import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useCalendar } from '../../lib/billing'
import { useStaffDay, useStaffRoster } from '../../lib/attendance'
import { formatDateBS } from '../../lib/format'
import {
  Button,
  EmptyState,
  Input,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconCheck, IconStudents, IconX } from '../../components/icons'

/**
 * Staff daily register — same tap-to-flip flow as the class register.
 * RFID punches (checked_in_at) surface beside manual marks when a device
 * recorded them.
 */

interface DraftRow {
  staff: string
  name: string
  present: boolean
  reason: string
  recordId: string | null
  checkedIn: string | null
}

export default function StaffAttendancePage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const calendar = useCalendar()
  const [dateBs, setDateBs] = useState('')
  const date = dateBs || calendar.data?.today_bs || ''

  const roster = useStaffRoster()
  const day = useStaffDay(date || null)
  const [rows, setRows] = useState<DraftRow[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!roster.data || !day.data || dirty) return
    const marked = new Map(day.data.map((r) => [r.staff, r]))
    setRows(
      roster.data.map((s) => {
        const record = marked.get(s.id)
        return {
          staff: s.id,
          name: s.full_name,
          present: record?.present ?? true,
          reason: record?.reason ?? '',
          recordId: record?.id ?? null,
          checkedIn: record?.checked_in_at ?? null,
        }
      }),
    )
  }, [roster.data, day.data, dirty])

  const absentees = rows.filter((r) => !r.present)

  const save = useMutation({
    mutationFn: async () => {
      // The staff register is plain CRUD (no bulk endpoint): create missing
      // rows, patch changed ones.
      await Promise.all(
        rows.map((row) => {
          const payload = {
            date_bs: date,
            staff: row.staff,
            present: row.present,
            reason: row.present ? '' : row.reason,
          }
          if (row.recordId)
            return api.patch(`/api/v1/attendance/staff/${row.recordId}/`, payload)
          return api.post('/api/v1/attendance/staff/', payload)
        }),
      )
    },
    onSuccess: () => {
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ['attendance', 'staff-day'] })
      toast.success('Staff attendance saved.')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <Input
          value={date}
          onChange={(e) => {
            setDateBs(e.target.value)
            setDirty(false)
          }}
          aria-label="Date (BS)"
          className="w-44"
        />
        <p className="text-sm text-ink-muted">{formatDateBS(date)}</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {roster.isLoading || day.isLoading ? (
          <SkeletonRows rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<IconStudents size={22} />} title="No employed staff" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.staff}>
                <div
                  className={`flex items-center gap-3 px-4 py-2.5 sm:px-5 ${
                    row.present ? '' : 'bg-danger-soft/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setDirty(true)
                      setRows((rs) =>
                        rs.map((r) =>
                          r.staff === row.staff ? { ...r, present: !r.present } : r,
                        ),
                      )
                    }}
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
                      {row.checkedIn && (
                        <span className="block text-xs text-ink-muted">
                          punched in {new Date(row.checkedIn).toLocaleTimeString()}
                        </span>
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
                            r.staff === row.staff ? { ...r, reason: e.target.value } : r,
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
            <span className="font-semibold text-positive">
              {rows.length - absentees.length} present
            </span>
            {absentees.length > 0 && (
              <>
                {' · '}
                <span className="font-semibold text-danger">{absentees.length} absent</span>
              </>
            )}
          </p>
          <Button busy={save.isPending} onClick={() => save.mutate()}>
            Save staff attendance
          </Button>
        </div>
      )}
    </div>
  )
}
