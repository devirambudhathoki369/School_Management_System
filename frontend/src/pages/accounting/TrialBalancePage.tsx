import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useCalendar } from '../../lib/billing'
import {
  currentFiscalYear,
  useFiscalYears,
  type TrialBalance,
} from '../../lib/accounting'
import { formatMoney } from '../../lib/format'
import { Badge, EmptyState, Field, Input, Select, SkeletonRows } from '../../components/ui'
import { IconChevronDown, IconChevronRight } from '../../components/icons'

/**
 * Trial balance: opening, period movement and closing per ledger, grouped
 * by ledger group. Groups collapse (the accountant scans group subtotals
 * first); the whole table scrolls horizontally on phones rather than
 * squeezing six money columns.
 */

export default function TrialBalancePage() {
  const fiscalYears = useFiscalYears()
  const calendar = useCalendar()
  const [fiscalYear, setFiscalYear] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const year =
    (fiscalYears.data ?? []).find((y) => y.id === fiscalYear) ??
    currentFiscalYear(fiscalYears.data)

  // Default the range to the fiscal year, capped at today.
  useEffect(() => {
    if (year && !start) {
      setStart(year.start_date_bs)
      const today = calendar.data?.today_bs
      setEnd(today && today < year.end_date_bs ? today : year.end_date_bs)
    }
  }, [year, start, calendar.data])

  const report = useQuery({
    queryKey: ['accounting', 'trial-balance', year?.id, start, end],
    queryFn: async () =>
      (
        await api.get<TrialBalance>('/api/v1/accounting/vouchers/trial-balance/', {
          params: { fiscal_year: year!.id, start_date_bs: start, end_date_bs: end },
        })
      ).data,
    enabled: !!year && !!start && !!end,
  })

  const data = report.data
  const balances = data && data.total_closing_debit === data.total_closing_credit

  return (
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:max-w-2xl">
        <Field label="Fiscal year">
          <Select
            value={year?.id ?? ''}
            onChange={(e) => {
              setFiscalYear(e.target.value)
              setStart('')
            }}
          >
            {(fiscalYears.data ?? []).map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From (BS)">
          <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="2082-04-01" />
        </Field>
        <Field label="To (BS)">
          <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="2083-03-30" />
        </Field>
      </div>

      {report.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={8} />
        </div>
      ) : !data || data.data.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            title="Nothing in this period"
            hint="No opening balances or voucher movement fall inside the selected range."
          />
        </div>
      ) : (
        <>
          <div className="mb-3">
            {balances ? (
              <Badge tone="positive">Books balance — Dr equals Cr</Badge>
            ) : (
              <Badge tone="warning">
                Closing Dr ≠ Cr (legacy entries flagged for review can cause this)
              </Badge>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Ledger</th>
                  <th className="px-3 py-2.5 text-right font-medium">Opening Dr</th>
                  <th className="px-3 py-2.5 text-right font-medium">Opening Cr</th>
                  <th className="px-3 py-2.5 text-right font-medium">Debit</th>
                  <th className="px-3 py-2.5 text-right font-medium">Credit</th>
                  <th className="px-3 py-2.5 text-right font-medium">Closing Dr</th>
                  <th className="px-4 py-2.5 text-right font-medium">Closing Cr</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((group) => {
                  const expanded = open.has(group.group)
                  return (
                    <GroupRows
                      key={group.group}
                      group={group}
                      expanded={expanded}
                      onToggle={() =>
                        setOpen((s) => {
                          const next = new Set(s)
                          if (expanded) next.delete(group.group)
                          else next.add(group.group)
                          return next
                        })
                      }
                    />
                  )
                })}
              </tbody>
              <tfoot className="border-t-2 border-border bg-surface-muted font-semibold">
                <tr>
                  <td className="px-4 py-2.5">Total</td>
                  {[
                    data.total_opening_debit,
                    data.total_opening_credit,
                    data.total_debit,
                    data.total_credit,
                    data.total_closing_debit,
                    data.total_closing_credit,
                  ].map((v, i) => (
                    <td key={i} className={`px-3 py-2.5 text-right tabular-nums ${i === 5 ? 'pr-4' : ''}`}>
                      {formatMoney(v)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function GroupRows({
  group,
  expanded,
  onToggle,
}: {
  group: TrialBalance['data'][number]
  expanded: boolean
  onToggle: () => void
}) {
  const money = (v: string) => (Number(v) === 0 ? '—' : formatMoney(v))
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-border bg-surface-muted/50 font-medium hover:bg-surface-sunken"
      >
        <td className="px-4 py-2.5">
          <span className="mr-1.5 inline-block align-[-2px] text-ink-faint">
            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </span>
          {group.group}
          <span className="ml-2 text-xs font-normal text-ink-faint">
            {group.ledgers.length} ledger{group.ledgers.length === 1 ? '' : 's'}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">{money(group.group_opening_debit)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{money(group.group_opening_credit)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{money(group.group_debit)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{money(group.group_credit)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{money(group.group_closing_debit)}</td>
        <td className="px-4 py-2.5 text-right tabular-nums">{money(group.group_closing_credit)}</td>
      </tr>
      {expanded &&
        group.ledgers.map((row) => (
          <tr key={row.id} className="border-b border-border last:border-0">
            <td className="py-2 pl-10 pr-4 text-ink-muted">{row.ledger}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(row.opening_debit)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(row.opening_credit)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(row.debit)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(row.credit)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{money(row.closing_debit)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{money(row.closing_credit)}</td>
          </tr>
        ))}
    </>
  )
}
