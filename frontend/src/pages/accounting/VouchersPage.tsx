import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { Paginated } from '../../lib/billing'
import {
  VOUCHER_TYPE_LABEL,
  currentFiscalYear,
  useFiscalYears,
  type Voucher,
} from '../../lib/accounting'
import { formatDateBS, formatMoney, sumAmounts } from '../../lib/format'
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Money,
  Pagination,
  Select,
  SkeletonRows,
} from '../../components/ui'
import { IconLayers, IconPlus } from '../../components/icons'

/**
 * Voucher register. Every money movement of the school in one place; the
 * balance is enforced by a database trigger, so what this table shows is
 * what the books actually hold. Legacy oddities arrive flagged
 * `needs_review` instead of silently blending in.
 */

const PAGE_SIZE = 50

const TYPE_TONE = {
  income: 'positive',
  expense: 'danger',
  journal: 'accent',
  contra: 'neutral',
} as const

export default function VouchersPage() {
  const fiscalYears = useFiscalYears()
  const [fiscalYear, setFiscalYear] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  const activeYear = fiscalYear || currentFiscalYear(fiscalYears.data)?.id || ''

  const { data, isLoading } = useQuery({
    queryKey: ['accounting', 'vouchers', activeYear, type, page],
    queryFn: async () =>
      (
        await api.get<Paginated<Voucher>>('/api/v1/accounting/vouchers/', {
          params: {
            page,
            fiscal_year: activeYear || undefined,
            voucher_type: type || undefined,
          },
        })
      ).data,
    enabled: !!activeYear,
    placeholderData: keepPreviousData,
  })

  const rows = data?.results ?? []

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select
          value={activeYear}
          onChange={(e) => {
            setFiscalYear(e.target.value)
            setPage(1)
          }}
          aria-label="Fiscal year"
          className="sm:w-52"
        >
          {(fiscalYears.data ?? []).map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
              {y.closed ? ' (closed)' : ''}
            </option>
          ))}
        </Select>
        <Select
          value={type}
          onChange={(e) => {
            setType(e.target.value)
            setPage(1)
          }}
          aria-label="Voucher type"
          className="sm:w-44"
        >
          <option value="">All types</option>
          {Object.entries(VOUCHER_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <div className="sm:ml-auto">
          <Link to="/accounting/new">
            <Button>
              <IconPlus size={16} /> New voucher
            </Button>
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading || fiscalYears.isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconLayers size={22} />}
            title="No vouchers here yet"
            hint="Every income, expense and journal entry lands in this register."
            action={
              <Link to="/accounting/new">
                <Button>
                  <IconPlus size={16} /> Enter the first voucher
                </Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => setOpenId(v.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted sm:px-5"
                >
                  <span className="w-20 shrink-0 text-sm font-medium tabular-nums">
                    {v.number}
                  </span>
                  <Badge tone={TYPE_TONE[v.voucher_type]}>
                    {VOUCHER_TYPE_LABEL[v.voucher_type]}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                    {formatDateBS(v.date_bs)}
                    {v.remarks && <> · {v.remarks}</>}
                  </span>
                  {v.needs_review && <Badge tone="warning">review</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && (
        <Pagination
          count={data.count}
          page={page}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          label="vouchers"
        />
      )}

      <VoucherDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function VoucherDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['accounting', 'voucher', id],
    queryFn: async () => (await api.get<Voucher>(`/api/v1/accounting/vouchers/${id}/`)).data,
    enabled: !!id,
  })
  const v = detail.data
  const lines = v?.lines ?? []
  const debit = sumAmounts(lines.filter((l) => l.side === 'dr').map((l) => l.amount))
  const credit = sumAmounts(lines.filter((l) => l.side === 'cr').map((l) => l.amount))

  return (
    <Modal open={!!id} onClose={onClose} title={v ? `Voucher ${v.number}` : 'Voucher'} wide>
      {detail.isLoading && <SkeletonRows rows={4} />}
      {v && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <Badge tone={TYPE_TONE[v.voucher_type]}>{VOUCHER_TYPE_LABEL[v.voucher_type]}</Badge>
            <span>{formatDateBS(v.date_bs)}</span>
            {v.mode && <span className="capitalize">· {v.mode}</span>}
            {v.needs_review && <Badge tone="warning">needs review</Badge>}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Ledger</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={line.id ?? i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">
                      {line.ledger_name}
                      {line.remarks && (
                        <span className="block text-xs text-ink-faint">{line.remarks}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {line.side === 'dr' ? formatMoney(line.amount) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {line.side === 'cr' ? formatMoney(line.amount) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-surface-muted font-semibold">
                <tr>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right">
                    <Money value={debit} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Money value={credit} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {v.remarks && <p className="mt-3 text-sm text-ink-muted">Remarks: {v.remarks}</p>}
        </div>
      )}
    </Modal>
  )
}
