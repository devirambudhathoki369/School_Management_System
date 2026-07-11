import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useCalendar } from '../../lib/billing'
import { formatDateBS, formatMoney } from '../../lib/format'
import { PrintMirror } from '../billing/ReceiptSheet'
import {
  Button,
  EmptyState,
  Field,
  Input,
  Money,
  SkeletonRows,
  StatCard,
} from '../../components/ui'
import { IconPrinter, IconWallet } from '../../components/icons'

/**
 * Salary sheet: the whole payroll for a BS date range in one grid — per-head
 * gross, withholdings, net payable, what's actually been paid, and who still
 * has a balance. This is the sheet the accountant signs each month; it
 * prints through #print-root on the school letterhead.
 */

interface SheetRow {
  staff: string
  name: string
  designation: string
  salary: string
  grade: string
  allowance: string
  extra: string
  total: string
  tax: string
  pf: string
  insurance: string
  deduction: string
  net: string
  paid: string
  balance: string
}

const sum = (rows: SheetRow[], key: keyof SheetRow) =>
  rows.reduce((n, r) => n + Number(r[key] || 0), 0)

export default function SalarySheetPage() {
  const calendar = useCalendar()
  const today = calendar.data?.today_bs
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  // Default to the current BS month so the sheet opens meaningful.
  const effectiveStart = start || (today ? `${today.slice(0, 8)}01` : '')
  const effectiveEnd = end || today || ''

  const sheet = useQuery({
    queryKey: ['payroll', 'salary-sheet', effectiveStart, effectiveEnd],
    queryFn: async () =>
      (
        await api.get<SheetRow[]>('/api/v1/payroll/payments/salary-sheet/', {
          params: { start_date_bs: effectiveStart, end_date_bs: effectiveEnd },
        })
      ).data,
    enabled: !!effectiveStart && !!effectiveEnd,
  })

  const rows = (sheet.data ?? []).filter((r) => Number(r.total) !== 0 || Number(r.paid) !== 0)
  const totals = {
    gross: sum(rows, 'total'),
    deduction: sum(rows, 'deduction'),
    net: sum(rows, 'net'),
    paid: sum(rows, 'paid'),
    balance: sum(rows, 'balance'),
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From (BS)" className="w-36">
          <Input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder={effectiveStart || '2082-01-01'}
          />
        </Field>
        <Field label="To (BS)" className="w-36">
          <Input
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            placeholder={effectiveEnd || '2082-01-30'}
          />
        </Field>
        {rows.length > 0 && (
          <div className="ml-auto">
            <Button variant="secondary" onClick={() => window.print()}>
              <IconPrinter size={16} /> Print salary sheet
            </Button>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Gross accrued" value={<Money value={totals.gross} />} detail={`${rows.length} staff`} />
          <StatCard label="Withholdings" value={<Money value={totals.deduction} />} detail="TDS + PF + insurance" />
          <StatCard label="Net paid" value={<Money value={totals.paid} />} />
          <StatCard
            label="Balance"
            value={<Money value={Math.abs(totals.balance)} />}
            detail={
              totals.balance > 0
                ? 'still payable to staff'
                : totals.balance < 0
                  ? 'paid in advance'
                  : 'fully settled'
            }
          />
        </div>
      )}

      {sheet.isLoading ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={8} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconWallet size={22} />}
          title="Nothing in this range"
          hint="No salary accruals or payments fall between these dates."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <SheetTable rows={rows} totals={totals} />
        </div>
      )}

      <PrintMirror>
        <SheetPrint
          rows={rows}
          totals={totals}
          start={effectiveStart}
          end={effectiveEnd}
        />
      </PrintMirror>
    </div>
  )
}

function SheetTable({
  rows,
  totals,
  print = false,
}: {
  rows: SheetRow[]
  totals: Record<string, number>
  print?: boolean
}) {
  const money = (v: string | number) => formatMoney(v)
  const border = print ? 'border-black/40' : 'border-border'
  return (
    <table className={`w-full min-w-[860px] text-sm ${print ? 'text-[12px]' : ''}`}>
      <thead
        className={`border-b ${border} text-xs uppercase tracking-wide ${
          print ? 'text-black' : 'text-ink-muted'
        }`}
      >
        <tr>
          <th className="px-3 py-2 text-left font-medium">Staff</th>
          <th className="px-2 py-2 text-right font-medium">Salary</th>
          <th className="px-2 py-2 text-right font-medium">Grade</th>
          <th className="px-2 py-2 text-right font-medium">Allowance</th>
          <th className="px-2 py-2 text-right font-medium">Extra</th>
          <th className="px-2 py-2 text-right font-medium">Gross</th>
          <th className="px-2 py-2 text-right font-medium">Deductions</th>
          <th className="px-2 py-2 text-right font-medium">Net</th>
          <th className="px-2 py-2 text-right font-medium">Paid</th>
          <th className="px-3 py-2 text-right font-medium">Balance</th>
        </tr>
      </thead>
      <tbody className={`divide-y ${print ? 'divide-black/15' : 'divide-border'}`}>
        {rows.map((r) => (
          <tr key={r.staff}>
            <td className="px-3 py-2">
              <span className="font-medium capitalize">{r.name}</span>
              <span className={`block text-xs ${print ? '' : 'text-ink-muted'}`}>
                {r.designation}
              </span>
            </td>
            <td className="px-2 py-2 text-right tabular-nums">{money(r.salary)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(r.grade)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(r.allowance)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(r.extra)}</td>
            <td className="px-2 py-2 text-right font-medium tabular-nums">{money(r.total)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(r.deduction)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(r.net)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(r.paid)}</td>
            <td
              className={`px-3 py-2 text-right font-medium tabular-nums ${
                Number(r.balance) > 0 && !print ? 'text-warning' : ''
              }`}
            >
              {money(r.balance)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot className={`border-t-2 font-semibold ${print ? 'border-black' : 'border-border'}`}>
        <tr>
          <td className="px-3 py-2">Total</td>
          <td colSpan={4} />
          <td className="px-2 py-2 text-right tabular-nums">{money(totals.gross)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{money(totals.deduction)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{money(totals.net)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{money(totals.paid)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{money(totals.balance)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

function SheetPrint({
  rows,
  totals,
  start,
  end,
}: {
  rows: SheetRow[]
  totals: Record<string, number>
  start: string
  end: string
}) {
  const { account } = useAuth()
  const school = account?.school
  if (rows.length === 0) return null
  return (
    <div className="bg-white p-6 text-black">
      <header className="mb-3 text-center">
        <h1 className="text-lg font-bold uppercase tracking-wide">{school?.name}</h1>
        {school?.address && <p className="text-xs">{school.address}</p>}
        <p className="mt-1 text-sm font-bold uppercase tracking-[0.2em]">Salary sheet</p>
        <p className="text-xs">
          {formatDateBS(start)} — {formatDateBS(end)} (BS)
        </p>
      </header>
      <SheetTable rows={rows} totals={totals} print />
      <footer className="mt-10 flex items-end justify-between text-xs">
        <span className="border-t border-black px-4 pt-1">Prepared by</span>
        <span className="border-t border-black px-4 pt-1">Accountant</span>
        <span className="border-t border-black px-4 pt-1">Principal</span>
      </footer>
    </div>
  )
}
