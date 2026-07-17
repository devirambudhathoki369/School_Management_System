import { useMemo, useState } from 'react'
import { EDUCATION_LEVELS } from '../../lib/academics'
import { Field, Select, StatCard } from '../../components/ui'
import { IconWallet } from '../../components/icons'
import { BS_MONTHS_SHORT, formatMoney } from '../../lib/format'
import { useIncomePlanReport } from '../../lib/reports'
import { ReportActions, ReportBody, ReportPrintSheet, type Col } from './shared'

/**
 * Income plan: projected net income per class × fee title for the picked
 * months — the fee plan × roster × standing discounts, with transport
 * projected from station rates (exact legacy algorithm; D1 pct-wins).
 */

type PlanRow = { id: string; label: string; students: number; cells: Record<string, string>; total: number }

export default function IncomePlanPage() {
  const [months, setMonths] = useState<number[]>([])
  const [level, setLevel] = useState('')
  const report = useIncomePlanReport(months, level)

  const { columns, rows, grand } = useMemo(() => {
    const payload = report.data
    if (!payload) return { columns: [] as Array<Col<PlanRow>>, rows: [] as PlanRow[], grand: 0 }
    const titleIds = Object.keys(payload.titles)
    const rows: PlanRow[] = payload.classes.map((cls) => {
      const cells = payload.data[cls.id] ?? {}
      const total = titleIds.reduce((acc, id) => acc + Number(cells[id] ?? 0), 0)
      return { id: cls.id, label: cls.label, students: cls.students, cells, total }
    })
    const columns: Array<Col<PlanRow>> = [
      { key: 'class', label: 'Class', render: (r) => r.label },
      { key: 'students', label: 'Students', align: 'right', render: (r) => r.students },
      ...titleIds.map((id) => ({
        key: id,
        label: payload.titles[id],
        align: 'right' as const,
        render: (r: PlanRow) => (r.cells[id] != null ? formatMoney(r.cells[id]) : '—'),
        csv: (r: PlanRow) => r.cells[id] ?? '',
      })),
      {
        key: 'total',
        label: 'Total',
        align: 'right',
        render: (r) => formatMoney(r.total),
        csv: (r) => r.total,
      },
    ]
    return { columns, rows, grand: rows.reduce((acc, r) => acc + r.total, 0) }
  }, [report.data])

  function toggleMonth(m: number) {
    setMonths((state) => (state.includes(m) ? state.filter((x) => x !== m) : [...state, m]))
  }

  return (
    <div>
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-muted">Months (BS)</p>
          <div className="flex flex-wrap gap-1.5">
            {BS_MONTHS_SHORT.map((name, i) => {
              const m = i + 1
              const active = months.includes(m)
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleMonth(m)}
                  aria-pressed={active}
                  className={`press h-9 rounded-lg px-3 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-accent text-white shadow-sm'
                      : 'bg-surface-sunken text-ink-muted hover:text-ink'
                  }`}
                >
                  {name}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() =>
                setMonths(months.length === 12 ? [] : Array.from({ length: 12 }, (_, i) => i + 1))
              }
              className="press h-9 rounded-lg px-3 text-sm font-medium text-accent-strong hover:bg-accent-soft"
            >
              {months.length === 12 ? 'Clear all' : 'All year'}
            </button>
          </div>
        </div>
        <Field label="Education level">
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">All levels</option>
            {EDUCATION_LEVELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {months.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-sm text-ink-muted">
          Pick one or more months — the plan projects fee income for exactly
          those months from the live fee plan, roster and standing discounts.
        </p>
      ) : (
        <>
          {rows.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3 lg:max-w-md">
              <StatCard label="Classes" value={rows.length} tone="accent" icon={<IconWallet size={16} />} />
              <StatCard label="Projected income" value={`Rs. ${formatMoney(grand)}`} tone="positive" />
            </div>
          )}
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-muted">Income plan</h2>
            <ReportActions title="income-plan" columns={columns} rows={rows} onPrint={() => window.print()} />
          </div>
          <ReportBody
            loading={report.isLoading}
            empty={rows.length === 0}
            emptyTitle="Nothing to project"
            emptyHint="No class has both students and a fee plan overlapping the picked months."
          >
            <div className="overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full min-w-max border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken/60 text-left text-xs uppercase tracking-wide text-ink-muted">
                    {columns.map((c) => (
                      <th key={c.key} className={`px-3 py-2.5 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-surface-sunken/40">
                      {columns.map((c) => (
                        <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>
                          {c.render(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-surface-sunken/70 font-semibold">
                    <td className="px-3 py-2.5" colSpan={columns.length - 1}>
                      Grand total
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(grand)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <ReportPrintSheet
              title="Income plan"
              meta={`Months: ${months
                .slice()
                .sort((a, b) => a - b)
                .map((m) => BS_MONTHS_SHORT[m - 1])
                .join(', ')}`}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              totals={[{ label: 'Projected', value: `Rs. ${formatMoney(grand)}` }]}
            />
          </ReportBody>
        </>
      )}
    </div>
  )
}
