import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useCalendar } from '../../lib/billing'
import {
  currentFiscalYear,
  useFiscalYears,
  type BalanceSheet,
  type CashFlow,
  type CashFlowSection,
  type IncomeStatement,
  type StatementGroup,
} from '../../lib/accounting'
import { formatDateBS, formatMoney } from '../../lib/format'
import { Badge, EmptyState, Field, Input, Select, SkeletonRows } from '../../components/ui'

/**
 * The two financial statements (docs §10): P&L for the fiscal year through
 * a BS date, and the balance sheet as of that date. Both come from the same
 * signed-balance service, so equity here always carries the P&L's net —
 * the sheet balances by construction when the books do.
 */

function useStatementScope() {
  const fiscalYears = useFiscalYears()
  const calendar = useCalendar()
  const [fiscalYear, setFiscalYear] = useState('')
  const [end, setEnd] = useState('')

  const year =
    (fiscalYears.data ?? []).find((y) => y.id === fiscalYear) ??
    currentFiscalYear(fiscalYears.data)

  useEffect(() => {
    if (year && !end) {
      const today = calendar.data?.today_bs
      setEnd(today && today < year.end_date_bs && today > year.start_date_bs
        ? today
        : year.end_date_bs)
    }
  }, [year, end, calendar.data])

  const controls = (
    <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:max-w-lg">
      <Field label="Fiscal year">
        <Select
          value={year?.id ?? ''}
          onChange={(e) => {
            setFiscalYear(e.target.value)
            setEnd('')
          }}
        >
          {(fiscalYears.data ?? []).map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Through (BS)">
        <Input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="2083-03-30" />
      </Field>
    </div>
  )
  return { year, end, controls }
}

function SectionCard({
  title,
  tone,
  groups,
  total,
  extraRow,
}: {
  title: string
  tone: 'positive' | 'danger' | 'neutral'
  groups: StatementGroup[]
  total: string
  extraRow?: ReactNode
}) {
  const toneText =
    tone === 'positive' ? 'text-positive' : tone === 'danger' ? 'text-danger' : ''
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-baseline justify-between border-b border-border px-5 py-3.5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {title}
        </h3>
        <p className={`text-base font-semibold tabular-nums ${toneText}`}>
          {formatMoney(total)}
        </p>
      </div>
      {groups.length === 0 && !extraRow ? (
        <p className="px-5 py-6 text-sm text-ink-muted">Nothing posted in this period.</p>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((group) => (
            <div key={group.code} className="px-5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{group.group}</p>
                <p className="text-sm font-semibold tabular-nums">{formatMoney(group.total)}</p>
              </div>
              <ul className="mt-1.5 space-y-1">
                {group.ledgers.map((row) => (
                  <li key={row.id} className="flex justify-between gap-3 text-sm text-ink-muted">
                    <span className="truncate">{row.ledger}</span>
                    <span className="tabular-nums">{formatMoney(row.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {extraRow}
        </div>
      )}
    </div>
  )
}

export function ProfitLossPage() {
  const { year, end, controls } = useStatementScope()
  const report = useQuery({
    queryKey: ['accounting', 'income-statement', year?.id, end],
    queryFn: async () =>
      (
        await api.get<IncomeStatement>('/api/v1/accounting/vouchers/income-statement/', {
          params: { fiscal_year: year!.id, end_date_bs: end },
        })
      ).data,
    enabled: !!year && !!end,
  })

  const data = report.data
  const net = Number(data?.net ?? 0)

  return (
    <div>
      {controls}
      {report.isLoading || !data ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={6} />
        </div>
      ) : data.income.length === 0 && data.expense.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            title="No income or expense entries"
            hint="Post income and expense vouchers to build the P&L."
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div
            className={`flex flex-wrap items-baseline justify-between gap-2 rounded-xl border p-5 ${
              net >= 0 ? 'border-positive/30 bg-positive-soft' : 'border-danger/30 bg-danger-soft'
            }`}
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Net {net >= 0 ? 'profit' : 'loss'}
                {year ? ` · ${year.name}` : ''} {end ? `through ${formatDateBS(end)}` : ''}
              </p>
              <p
                className={`mt-1 text-2xl font-semibold tabular-nums ${
                  net >= 0 ? 'text-positive' : 'text-danger'
                }`}
              >
                {formatMoney(data.net)}
              </p>
            </div>
            <p className="text-sm text-ink-muted">
              Income {formatMoney(data.total_income)} − Expenses{' '}
              {formatMoney(data.total_expense)}
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Income"
              tone="positive"
              groups={data.income}
              total={data.total_income}
            />
            <SectionCard
              title="Expenses"
              tone="danger"
              groups={data.expense}
              total={data.total_expense}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function BalanceSheetPage() {
  const { year, end, controls } = useStatementScope()
  const report = useQuery({
    queryKey: ['accounting', 'balance-sheet', year?.id, end],
    queryFn: async () =>
      (
        await api.get<BalanceSheet>('/api/v1/accounting/vouchers/balance-sheet/', {
          params: { fiscal_year: year!.id, end_date_bs: end },
        })
      ).data,
    enabled: !!year && !!end,
  })

  const data = report.data
  const empty =
    data && data.assets.length === 0 && data.liabilities.length === 0 &&
    data.equity.length === 0 && Number(data.net_profit) === 0

  return (
    <div>
      {controls}
      {report.isLoading || !data ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={6} />
        </div>
      ) : empty ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            title="No balances yet"
            hint="Opening balances and posted vouchers build the balance sheet."
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {data.balanced ? (
              <Badge tone="positive">
                Balanced — assets equal liabilities + equity
              </Badge>
            ) : (
              <Badge tone="warning">
                Off balance by{' '}
                {formatMoney(
                  Number(data.total_assets) -
                    Number(data.total_liabilities) -
                    Number(data.total_equity),
                )}{' '}
                — check opening balances and needs-review vouchers
              </Badge>
            )}
            <span className="text-xs text-ink-faint">
              as of {formatDateBS(end)}
            </span>
          </div>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <SectionCard
              title="Assets"
              tone="neutral"
              groups={data.assets}
              total={data.total_assets}
            />
            <div className="space-y-4">
              <SectionCard
                title="Liabilities"
                tone="neutral"
                groups={data.liabilities}
                total={data.total_liabilities}
              />
              <SectionCard
                title="Equity"
                tone="neutral"
                groups={data.equity}
                total={data.total_equity}
                extraRow={
                  <div className="flex items-baseline justify-between gap-3 bg-surface-sunken px-5 py-3">
                    <p className="text-sm font-medium">
                      Net {Number(data.net_profit) >= 0 ? 'profit' : 'loss'} for the period
                    </p>
                    <p
                      className={`text-sm font-semibold tabular-nums ${
                        Number(data.net_profit) >= 0 ? 'text-positive' : 'text-danger'
                      }`}
                    >
                      {formatMoney(data.net_profit)}
                    </p>
                  </div>
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FlowSection({ title, section }: { title: string; section: CashFlowSection }) {
  const total = Number(section.total)
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-baseline justify-between border-b border-border px-5 py-3.5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
        <p
          className={`text-base font-semibold tabular-nums ${
            total > 0 ? 'text-positive' : total < 0 ? 'text-danger' : ''
          }`}
        >
          {formatMoney(section.total)}
        </p>
      </div>
      {section.items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-ink-muted">No movement in this period.</p>
      ) : (
        <ul className="divide-y divide-border">
          {section.items.map((row) => (
            <li key={row.id} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
              <span className="truncate text-ink-muted">{row.ledger}</span>
              <span
                className={`tabular-nums ${Number(row.amount) < 0 ? 'text-danger' : ''}`}
              >
                {formatMoney(row.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CashFlowPage() {
  const { year, end, controls } = useStatementScope()
  const report = useQuery({
    queryKey: ['accounting', 'cash-flow', year?.id, end],
    queryFn: async () =>
      (
        await api.get<CashFlow>('/api/v1/accounting/vouchers/cash-flow/', {
          params: { fiscal_year: year!.id, end_date_bs: end },
        })
      ).data,
    enabled: !!year && !!end,
  })

  const data = report.data
  const change = Number(data?.net_change ?? 0)

  return (
    <div>
      {controls}
      {report.isLoading || !data ? (
        <div className="rounded-xl border border-border bg-surface">
          <SkeletonRows rows={6} />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: 'Opening cash & bank', value: data.opening_cash, tone: '' },
              {
                label: 'Net change',
                value: data.net_change,
                tone: change > 0 ? 'text-positive' : change < 0 ? 'text-danger' : '',
              },
              { label: 'Closing cash & bank', value: data.closing_cash, tone: '' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border bg-surface p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  {stat.label}
                </p>
                <p className={`mt-1 text-xl font-semibold tabular-nums ${stat.tone}`}>
                  {formatMoney(stat.value)}
                </p>
              </div>
            ))}
          </div>
          {data.operating.net_profit !== undefined && (
            <p className="text-xs text-ink-faint">
              Operating includes net profit of {formatMoney(data.operating.net_profit)} —
              activities reconcile to the cash change by construction.
            </p>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-3">
            <FlowSection title="Operating" section={data.operating} />
            <FlowSection title="Investing" section={data.investing} />
            <FlowSection title="Financing" section={data.financing} />
          </div>
          {data.other.items.length > 0 && (
            <FlowSection title="Unclassified" section={data.other} />
          )}
        </div>
      )}
    </div>
  )
}
