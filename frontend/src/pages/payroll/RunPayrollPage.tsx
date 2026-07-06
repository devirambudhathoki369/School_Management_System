import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { currentBillingYear, useBillingYears, useCalendar, useYearPointers } from '../../lib/billing'
import {
  EARNING_TYPES,
  latestStructures,
  useAllStructures,
  useStaffLookup,
  type EarningType,
} from '../../lib/payroll'
import { BS_MONTHS, bsMonthShort, formatMoney } from '../../lib/format'
import {
  AmountInput,
  Button,
  EmptyState,
  Field,
  Input,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconStudents } from '../../components/icons'

/**
 * Payroll run: one posting accrues a month's salary for every selected
 * staff member. The grid arrives pre-filled from each person's current
 * salary structure — the clerk reviews and posts, instead of retyping four
 * numbers per employee every month.
 */

type Grid = Record<string, Record<EarningType, string>>

export default function RunPayrollPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const calendar = useCalendar()
  const billingYears = useBillingYears()
  const pointers = useYearPointers()
  const staff = useStaffLookup()
  const structures = useAllStructures()

  const [dateBs, setDateBs] = useState('')
  const [months, setMonths] = useState<Set<number>>(new Set())
  const [remarks, setRemarks] = useState('')
  const [included, setIncluded] = useState<Set<string>>(new Set())
  const [grid, setGrid] = useState<Grid>({})

  const employed = useMemo(
    () => (staff.data ?? []).filter((s) => s.status === 'employed'),
    [staff.data],
  )
  const current = useMemo(() => latestStructures(structures.data), [structures.data])

  useEffect(() => {
    if (calendar.data && !dateBs) {
      setDateBs(calendar.data.today_bs)
      setMonths(new Set([Number(calendar.data.today_bs.split('-')[1]) || 1]))
    }
  }, [calendar.data, dateBs])

  // Seed the grid from the structures once BOTH lists arrive; staff with a
  // structure are pre-selected — the run mirrors the agreed terms.
  useEffect(() => {
    if (!structures.isSuccess || employed.length === 0 || Object.keys(grid).length > 0) return
    const seeded: Grid = {}
    const preselected = new Set<string>()
    for (const s of employed) {
      const terms = current.get(s.id)
      seeded[s.id] = {
        salary: terms?.basic_salary && Number(terms.basic_salary) > 0 ? terms.basic_salary : '',
        grade: terms?.grade && Number(terms.grade) > 0 ? terms.grade : '',
        allowance: terms?.allowance && Number(terms.allowance) > 0 ? terms.allowance : '',
        extra: terms?.extra && Number(terms.extra) > 0 ? terms.extra : '',
      }
      if (terms) preselected.add(s.id)
    }
    setGrid(seeded)
    setIncluded(preselected)
  }, [structures.isSuccess, employed, current, grid])

  const rowTotal = (id: string) =>
    EARNING_TYPES.reduce((acc, head) => acc + (Number(grid[id]?.[head]) || 0), 0)
  const runTotal = [...included].reduce((acc, id) => acc + rowTotal(id), 0)

  const billingYear = currentBillingYear(billingYears.data, calendar.data?.today_bs)
  const academicYear = pointers.data?.[0]?.academic_year ?? null
  const ready =
    included.size > 0 &&
    months.size > 0 &&
    !!dateBs &&
    !!billingYear &&
    !!academicYear &&
    [...included].every((id) => rowTotal(id) > 0)

  const post = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ created: number }>('/api/v1/payroll/accruals/bulk/', {
          date_bs: dateBs,
          months: [...months].sort((a, b) => a - b),
          academic_year: academicYear,
          billing_year: billingYear!.id,
          remarks,
          rows: [...included].map((id) => ({
            staff: id,
            lines: EARNING_TYPES.filter((head) => Number(grid[id]?.[head]) > 0).map((head) => ({
              earning_type: head,
              amount: grid[id][head],
            })),
          })),
        })
      ).data,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      toast.success(`Payroll posted for ${res.created} staff.`)
      navigate('/payroll/postings')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  return (
    <div>
      <section className="mb-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Posting date (BS)">
            <Input value={dateBs} onChange={(e) => setDateBs(e.target.value)} />
          </Field>
          <Field label="Salary for months">
            <div className="flex flex-wrap gap-1.5">
              {BS_MONTHS.map((label, i) => {
                const value = i + 1
                const on = months.has(value)
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setMonths((m) => {
                        const next = new Set(m)
                        if (on) next.delete(value)
                        else next.add(value)
                        return next
                      })
                    }
                    className={`h-9 rounded-lg border px-2.5 text-[13px] font-medium transition-colors ${
                      on
                        ? 'border-accent bg-accent-soft text-accent-strong'
                        : 'border-border text-ink-muted hover:border-accent'
                    }`}
                  >
                    {bsMonthShort(value)}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="Remarks">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        {employed.length === 0 ? (
          <EmptyState
            icon={<IconStudents size={22} />}
            title={staff.isLoading ? 'Loading staff…' : 'No employed staff'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={included.size === employed.length && employed.length > 0}
                        onChange={(e) =>
                          setIncluded(e.target.checked ? new Set(employed.map((s) => s.id)) : new Set())
                        }
                        className="size-4 accent-(--color-accent-strong)"
                      />
                      Staff
                    </label>
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">Basic</th>
                  <th className="px-3 py-2.5 text-right font-medium">Grade</th>
                  <th className="px-3 py-2.5 text-right font-medium">Allowance</th>
                  <th className="px-3 py-2.5 text-right font-medium">Extra</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {employed.map((s) => {
                  const on = included.has(s.id)
                  return (
                    <tr key={s.id} className={`border-b border-border last:border-0 ${on ? '' : 'opacity-45'}`}>
                      <td className="px-4 py-2">
                        <label className="flex min-h-9 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(e) =>
                              setIncluded((set) => {
                                const next = new Set(set)
                                if (e.target.checked) next.add(s.id)
                                else next.delete(s.id)
                                return next
                              })
                            }
                            className="size-4 accent-(--color-accent-strong)"
                          />
                          <span>
                            <span className="block font-medium">{s.full_name}</span>
                            <span className="block text-xs text-ink-muted">
                              {s.role_name}
                              {!current.get(s.id) && ' · no salary structure'}
                            </span>
                          </span>
                        </label>
                      </td>
                      {EARNING_TYPES.map((head) => (
                        <td key={head} className="px-3 py-2">
                          <AmountInput
                            value={grid[s.id]?.[head] ?? ''}
                            disabled={!on}
                            aria-label={`${s.full_name} ${head}`}
                            className="w-24"
                            onChange={(e) =>
                              setGrid((g) => ({
                                ...g,
                                [s.id]: { ...g[s.id], [head]: e.target.value },
                              }))
                            }
                          />
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right font-medium tabular-nums">
                        {formatMoney(rowTotal(s.id))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-lg sm:px-5">
        <p className="text-sm">
          <span className="font-semibold">{included.size}</span> staff ·{' '}
          <span className="font-semibold tabular-nums">Rs. {formatMoney(runTotal)}</span> this run
          {billingYear && <span className="text-ink-faint"> · {billingYear.name}</span>}
        </p>
        <Button busy={post.isPending} disabled={!ready} onClick={() => post.mutate()}>
          Post payroll
        </Button>
      </div>
    </div>
  )
}
