import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useCalendar } from '../../lib/billing'
import {
  currentFiscalYear,
  useFiscalYears,
  useLedgers,
  type StatementEntry,
} from '../../lib/accounting'
import { formatDateBS, formatMoney } from '../../lib/format'
import { EmptyState, Field, Input, Select, SkeletonRows } from '../../components/ui'

/**
 * Ledger statement: one account's activity shown through its counterparties
 * (the classic single-ledger view an accountant reconciles against). The
 * opening balance is the first row; a running balance is computed on the
 * ledger's natural direction.
 */

export default function StatementPage() {
  const fiscalYears = useFiscalYears()
  const ledgers = useLedgers()
  const calendar = useCalendar()
  const [fiscalYear, setFiscalYear] = useState('')
  const [ledger, setLedger] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const year =
    (fiscalYears.data ?? []).find((y) => y.id === fiscalYear) ??
    currentFiscalYear(fiscalYears.data)

  useEffect(() => {
    if (year && !start) {
      setStart(year.start_date_bs)
      const today = calendar.data?.today_bs
      setEnd(today && today < year.end_date_bs ? today : year.end_date_bs)
    }
  }, [year, start, calendar.data])

  const report = useQuery({
    queryKey: ['accounting', 'statement', year?.id, ledger, start, end],
    queryFn: async () =>
      (
        await api.get<StatementEntry[]>('/api/v1/accounting/vouchers/ledger-report/', {
          params: {
            fiscal_year: year!.id,
            ledger,
            start_date_bs: start,
            end_date_bs: end,
          },
        })
      ).data,
    enabled: !!year && !!ledger && !!start && !!end,
  })

  // Running balance: signed on the statement's own sides (Dr positive).
  let running = 0
  const rows = (report.data ?? []).map((entry) => {
    const signed = (Number(entry.amount) || 0) * (entry.side === 'dr' ? 1 : entry.side === 'cr' ? -1 : 0)
    running += signed
    return { ...entry, running }
  })

  return (
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Ledger">
          <Select value={ledger} onChange={(e) => setLedger(e.target.value)}>
            <option value="">Choose a ledger…</option>
            {(ledgers.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} — {l.group_name}
              </option>
            ))}
          </Select>
        </Field>
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
          <Input value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="To (BS)">
          <Input value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {!ledger ? (
          <EmptyState
            title="Pick a ledger"
            hint="The statement lists every entry the account took part in, shown through its counterparties."
          />
        ) : report.isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState title="No activity in this period" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Date</th>
                  <th className="px-3 py-2.5 text-left font-medium">Voucher</th>
                  <th className="px-3 py-2.5 text-left font-medium">Particulars</th>
                  <th className="px-3 py-2.5 text-right font-medium">Debit</th>
                  <th className="px-3 py-2.5 text-right font-medium">Credit</th>
                  <th className="px-4 py-2.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry, i) => (
                  <tr
                    key={i}
                    className={`border-b border-border last:border-0 ${
                      entry.kind === 'opening' ? 'bg-surface-muted/60 font-medium' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                      {entry.date_bs ? formatDateBS(entry.date_bs) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{entry.voucher ?? '—'}</td>
                    <td className="px-3 py-2">
                      {entry.ledger}
                      {entry.narration && (
                        <span className="block text-xs text-ink-faint">{entry.narration}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {entry.side === 'dr' ? formatMoney(entry.amount) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {entry.side === 'cr' ? formatMoney(entry.amount) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">
                      {formatMoney(Math.abs(entry.running))}{' '}
                      <span className="text-xs text-ink-faint">{entry.running >= 0 ? 'Dr' : 'Cr'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
