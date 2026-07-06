import { useState } from 'react'
import {
  EARNING_LABEL,
  EARNING_TYPES,
  useHeadBalances,
  useStaffStatement,
} from '../../lib/payroll'
import { bsMonthName, formatDateBS, formatMoney } from '../../lib/format'
import StaffSelect from '../../components/StaffSelect'
import { Badge, EmptyState, Money, SkeletonRows, StatCard } from '../../components/ui'
import { IconWallet } from '../../components/icons'

/**
 * Staff ledger: what the school owes one employee and how it got there —
 * accruals debit the account, payments credit it, and every withholding
 * (TDS/PF/insurance) appears as its own settling entry, exactly how the
 * statement service reports it.
 */

export default function LedgerPage() {
  const [staff, setStaff] = useState('')
  const balances = useHeadBalances(staff || null)
  const statement = useStaffStatement(staff || null)

  // Running balance: accruals increase what is owed; payments and
  // withholdings both settle it.
  let running = 0
  const rows = (statement.data ?? []).map((entry) => {
    running +=
      (Number(entry.debit) || 0) - (Number(entry.credit) || 0) - (Number(entry.deduction) || 0)
    return { ...entry, running }
  })

  return (
    <div>
      <div className="mb-4 sm:max-w-sm">
        <StaffSelect value={staff} onChange={setStaff} autoFocus />
      </div>

      {staff && balances.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard
            label="Total outstanding"
            value={<Money value={balances.data.total} />}
            icon={<IconWallet size={16} />}
          />
          {EARNING_TYPES.map((head) => (
            <StatCard
              key={head}
              label={EARNING_LABEL[head]}
              value={<Money value={balances.data![head]} />}
            />
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {!staff ? (
          <EmptyState
            icon={<IconWallet size={22} />}
            title="Pick a staff member"
            hint="The ledger shows every accrual, payment and withholding, with a running balance."
          />
        ) : statement.isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState title="No payroll history yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Date</th>
                  <th className="px-3 py-2.5 text-left font-medium">Entry</th>
                  <th className="px-3 py-2.5 text-right font-medium">Accrued</th>
                  <th className="px-3 py-2.5 text-right font-medium">Settled</th>
                  <th className="px-4 py-2.5 text-right font-medium">Owed after</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry, i) => (
                  <tr key={`${entry.id}-${entry.kind}-${i}`} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-4 py-2 text-ink-muted">
                      {formatDateBS(entry.date_bs)}
                    </td>
                    <td className="px-3 py-2">
                      <span className="mr-2">
                        {entry.kind === 'accrual' ? (
                          <Badge tone="accent">salary posted</Badge>
                        ) : entry.kind === 'payment' ? (
                          <Badge tone="positive">paid{entry.serial ? ` #${entry.serial}` : ''}</Badge>
                        ) : (
                          <Badge tone="warning">withheld</Badge>
                        )}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {entry.kind === 'deduction'
                          ? entry.particulars.map(([label]) => label).join(', ')
                          : entry.months.filter(Boolean).map(bsMonthName).join(', ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {entry.debit ? formatMoney(entry.debit) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {entry.credit
                        ? formatMoney(entry.credit)
                        : entry.deduction
                          ? formatMoney(entry.deduction)
                          : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right font-medium tabular-nums">
                      {formatMoney(entry.running)}
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
