import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useSheet, useSheetMarks, useSheetRoster } from '../../lib/exams'
import { formatDateBS, formatMoney } from '../../lib/format'
import {
  AmountInput,
  Badge,
  Button,
  SkeletonRows,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconChevronLeft } from '../../components/icons'

/**
 * Marks entry: the class roster joined with existing marks. Totals and
 * pass/fail are never typed — the server computes them from the sheet's
 * scheme on save and this grid re-reads them. Published sheets go
 * read-only for staff (the admin may still amend).
 */

interface DraftMark {
  student: string
  name: string
  roll: string
  theory: string
  practical: string
  absent: boolean
  // server-computed echoes
  total: string | null
  passed: boolean | null
}

export default function MarksPage() {
  const { sheetId = '' } = useParams()
  const toast = useToast()
  const queryClient = useQueryClient()
  const { account } = useAuth()

  const sheet = useSheet(sheetId)
  const roster = useSheetRoster(sheetId)
  const marks = useSheetMarks(sheetId)

  const [rows, setRows] = useState<DraftMark[]>([])
  const [dirty, setDirty] = useState(false)

  const locked = !!sheet.data?.is_published && account?.role !== 'admin'
  const hasPractical =
    !!sheet.data?.full_marks_practical && Number(sheet.data.full_marks_practical) > 0

  // Join roster + existing marks once both arrive (or when a save
  // refreshes). Historical sheets may hold marks for students who are no
  // longer running (promoted/passed out) — those rows still must show, so
  // the grid is the UNION of the roster and the marked students.
  useEffect(() => {
    if (!roster.data || !marks.data || dirty) return
    const byStudent = new Map(marks.data.map((m) => [m.student, m]))
    const rosterIds = new Set(roster.data.map((s) => s.id))
    const fromRoster = roster.data.map((s) => {
      const mark = byStudent.get(s.id)
      return {
        student: s.id,
        name: s.full_name,
        roll: s.roll_no,
        theory: mark?.theory ?? '',
        practical: mark?.practical ?? '',
        absent: mark?.absent ?? false,
        total: mark?.total ?? null,
        passed: mark?.passed ?? null,
      }
    })
    const markedOnly = marks.data
      .filter((m) => !rosterIds.has(m.student))
      .map((m) => ({
        student: m.student,
        name: m.student_name ?? '—',
        roll: m.roll_no ?? '',
        theory: m.theory ?? '',
        practical: m.practical ?? '',
        absent: m.absent,
        total: m.total,
        passed: m.passed,
      }))
    setRows(
      [...fromRoster, ...markedOnly].sort((a, b) => a.name.localeCompare(b.name)),
    )
  }, [roster.data, marks.data, dirty])

  function patch(student: string, changes: Partial<DraftMark>) {
    setDirty(true)
    setRows((rs) => rs.map((r) => (r.student === student ? { ...r, ...changes } : r)))
  }

  const overMax = useMemo(() => {
    if (!sheet.data) return new Set<string>()
    const fmTheory = Number(
      hasPractical ? sheet.data.full_marks_theory : sheet.data.full_marks,
    )
    const fmPractical = Number(sheet.data.full_marks_practical || 0)
    return new Set(
      rows
        .filter(
          (r) =>
            (r.theory !== '' && Number(r.theory) > fmTheory) ||
            (hasPractical && r.practical !== '' && Number(r.practical) > fmPractical),
        )
        .map((r) => r.student),
    )
  }, [rows, sheet.data, hasPractical])

  const filled = rows.filter((r) => r.absent || r.theory !== '' || r.practical !== '')

  const save = useMutation({
    mutationFn: async () =>
      api.put(`/api/v1/examinations/sheets/${sheetId}/marks/entry/`, {
        marks: filled.map((r) => ({
          student: r.student,
          theory: r.theory === '' ? null : r.theory,
          practical: !hasPractical || r.practical === '' ? null : r.practical,
          absent: r.absent,
        })),
      }),
    onSuccess: async () => {
      setDirty(false)
      await queryClient.invalidateQueries({ queryKey: ['exams', 'marks', sheetId] })
      toast.success(`Marks saved for ${filled.length} student${filled.length === 1 ? '' : 's'}.`)
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  if (sheet.isLoading || roster.isLoading || marks.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-surface">
        <SkeletonRows rows={10} />
      </div>
    )
  }
  if (!sheet.data) return null
  const s = sheet.data

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          to="/exams/sheets"
          className="flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken"
        >
          <IconChevronLeft size={15} /> Sheets
        </Link>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{s.subject_name}</h2>
          <p className="text-xs text-ink-muted">
            FM {formatMoney(s.full_marks)} · PM {formatMoney(s.pass_marks)}
            {hasPractical && (
              <> · theory {formatMoney(s.full_marks_theory)} + practical {formatMoney(s.full_marks_practical)}</>
            )}
          </p>
        </div>
        <div className="ml-auto">
          {s.is_published ? (
            <Badge tone="positive">published {formatDateBS(s.published_date_bs)}</Badge>
          ) : (
            <Badge>draft</Badge>
          )}
        </div>
      </div>

      {locked && (
        <p className="mb-4 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
          This result is published — marks are locked. Ask the school admin for amendments.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Roll</th>
                <th className="px-3 py-2.5 text-left font-medium">Student</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {hasPractical ? 'Theory' : 'Marks'}
                </th>
                {hasPractical && <th className="px-3 py-2.5 text-right font-medium">Practical</th>}
                <th className="px-3 py-2.5 text-center font-medium">Absent</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-4 py-2.5 text-left font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.student}
                  className={`border-b border-border last:border-0 ${
                    overMax.has(row.student) ? 'bg-danger-soft/50' : ''
                  }`}
                >
                  <td className="px-4 py-2 text-ink-muted tabular-nums">{row.roll || '—'}</td>
                  <td className="px-3 py-2 font-medium">{row.name}</td>
                  <td className="px-3 py-2">
                    <AmountInput
                      value={row.theory}
                      disabled={locked || row.absent}
                      aria-label={`${row.name} ${hasPractical ? 'theory' : 'marks'}`}
                      className="ml-auto w-24"
                      onChange={(e) => patch(row.student, { theory: e.target.value })}
                    />
                  </td>
                  {hasPractical && (
                    <td className="px-3 py-2">
                      <AmountInput
                        value={row.practical}
                        disabled={locked || row.absent}
                        aria-label={`${row.name} practical`}
                        className="ml-auto w-24"
                        onChange={(e) => patch(row.student, { practical: e.target.value })}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={row.absent}
                      disabled={locked}
                      aria-label={`${row.name} absent`}
                      onChange={(e) =>
                        patch(row.student, {
                          absent: e.target.checked,
                          ...(e.target.checked ? { theory: '', practical: '' } : {}),
                        })
                      }
                      className="size-4 accent-(--color-accent-strong)"
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                    {row.total !== null ? formatMoney(row.total) : '—'}
                  </td>
                  <td className="px-4 py-2">
                    {row.absent ? (
                      <Badge tone="neutral">absent</Badge>
                    ) : row.passed === null ? (
                      <span className="text-xs text-ink-faint">unsaved</span>
                    ) : row.passed ? (
                      <Badge tone="positive">pass</Badge>
                    ) : (
                      <Badge tone="danger">fail</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!locked && (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg sm:px-5">
          <p className="text-sm text-ink-muted">
            {filled.length} of {rows.length} students have marks
            {overMax.size > 0 && (
              <span className="ml-2 font-medium text-danger">
                {overMax.size} over full marks
              </span>
            )}
          </p>
          <Button
            busy={save.isPending}
            disabled={filled.length === 0 || overMax.size > 0}
            onClick={() => save.mutate()}
          >
            Save marks
          </Button>
        </div>
      )}
    </div>
  )
}
