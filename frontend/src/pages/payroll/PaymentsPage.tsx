import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Paginated } from '../../lib/billing'
import { EARNING_LABEL, type SalaryPayment } from '../../lib/payroll'
import { bsMonthName, formatDateBS, formatMoney } from '../../lib/format'
import StaffSelect from '../../components/StaffSelect'
import {
  Badge,
  EmptyState,
  Modal,
  Money,
  Pagination,
  SkeletonRows,
} from '../../components/ui'
import { IconWallet } from '../../components/icons'

/** Salary payment register: every payslip, filterable by staff. */

const PAGE_SIZE = 50

export default function PaymentsPage() {
  const [staff, setStaff] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'payments', staff, page],
    queryFn: async () =>
      (
        await api.get<Paginated<SalaryPayment>>('/api/v1/payroll/payments/', {
          params: { page, staff: staff || undefined },
        })
      ).data,
    placeholderData: keepPreviousData,
  })

  const rows = data?.results ?? []

  return (
    <div>
      <div className="mb-4 sm:max-w-sm">
        <StaffSelect value={staff} onChange={(id) => { setStaff(id); setPage(1) }} />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconWallet size={22} />}
            title="No salary payments found"
            hint="Payments made from the Pay salary tab appear here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setOpenId(p.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.staff_name}</p>
                    <p className="text-xs text-ink-muted">
                      #{p.serial ?? p.legacy_serial ?? '—'} · {formatDateBS(p.date_bs)}
                      {p.payment_month > 0 && <> · {bsMonthName(p.payment_month)}</>} · {p.mode}
                    </p>
                  </div>
                  {Number(p.tds_amount) > 0 && <Badge>TDS {formatMoney(p.tds_amount)}</Badge>}
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(p.net_paid)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && (
        <Pagination count={data.count} page={page} pageSize={PAGE_SIZE} onPage={setPage} label="payments" />
      )}

      <PaymentDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function PaymentDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['payroll', 'payment', id],
    queryFn: async () => (await api.get<SalaryPayment>(`/api/v1/payroll/payments/${id}/`)).data,
    enabled: !!id,
  })
  const p = detail.data

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title={p ? `Payslip #${p.serial ?? p.legacy_serial ?? '—'} — ${p.staff_name}` : 'Payslip'}
    >
      {detail.isLoading && <SkeletonRows rows={4} />}
      {p && (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            {formatDateBS(p.date_bs)}
            {p.payment_month > 0 && <> · {bsMonthName(p.payment_month)}</>} ·{' '}
            <span className="capitalize">{p.mode}</span>
          </p>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                {(p.lines ?? []).map((line, i) => (
                  <tr key={line.id ?? i} className="border-b border-border">
                    <td className="px-3 py-2">{EARNING_LABEL[line.earning_type]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(line.amount)}</td>
                  </tr>
                ))}
                <tr className="border-b border-border font-medium">
                  <td className="px-3 py-2">Gross</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.gross)}</td>
                </tr>
                {[
                  ['TDS', p.tds_amount],
                  ['Provident fund', p.pf_amount],
                  ['Insurance', p.insurance_amount],
                ].map(
                  ([label, amount]) =>
                    Number(amount) > 0 && (
                      <tr key={label as string} className="border-b border-border text-ink-muted">
                        <td className="px-3 py-2">− {label}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(amount as string)}</td>
                      </tr>
                    ),
                )}
                <tr className="bg-surface-muted font-semibold">
                  <td className="px-3 py-2">Net paid</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Money value={p.net_paid} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {p.remarks && <p className="text-sm text-ink-muted">Remarks: {p.remarks}</p>}
        </div>
      )}
    </Modal>
  )
}
