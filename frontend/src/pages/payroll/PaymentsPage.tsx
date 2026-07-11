import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { Paginated } from '../../lib/billing'
import { EARNING_LABEL, type SalaryPayment } from '../../lib/payroll'
import { amountInWords, bsMonthName, formatDateBS, formatMoney } from '../../lib/format'
import StaffSelect from '../../components/StaffSelect'
import { PrintMirror } from '../billing/ReceiptSheet'
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  Money,
  Pagination,
  SkeletonRows,
} from '../../components/ui'
import { IconPrinter, IconWallet } from '../../components/icons'

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

          <Button className="w-full" variant="secondary" onClick={() => window.print()}>
            <IconPrinter size={16} /> Print payslip
          </Button>
          <PrintMirror>
            <PayslipSheet payment={p} />
          </PrintMirror>
        </div>
      )}
    </Modal>
  )
}

/** The paper payslip: letterhead, earnings/withholdings, net-pay hero and
 *  the amount in words — the line payroll clerks read out at hand-over. */
function PayslipSheet({ payment: p }: { payment: SalaryPayment }) {
  const { account } = useAuth()
  const school = account?.school
  return (
    <div className="mx-auto max-w-xl bg-white p-8 text-sm text-black">
      <header className="mb-4 text-center">
        <h1 className="text-lg font-bold uppercase tracking-wide">{school?.name}</h1>
        {school?.address && <p className="text-xs">{school.address}</p>}
        <p className="mx-auto mt-2 inline-block border-y border-black px-6 py-0.5 text-xs font-bold uppercase tracking-[0.25em]">
          Salary payslip
        </p>
      </header>
      <dl className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
        <div className="flex gap-1.5">
          <dt className="text-black/60">Employee:</dt>
          <dd className="font-semibold capitalize">{p.staff_name}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-black/60">Payslip no.:</dt>
          <dd className="font-semibold tabular-nums">#{p.serial ?? p.legacy_serial ?? '—'}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-black/60">Date:</dt>
          <dd className="tabular-nums">{formatDateBS(p.date_bs)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-black/60">Period:</dt>
          <dd>{p.payment_month > 0 ? bsMonthName(p.payment_month) : '—'}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-black/60">Mode:</dt>
          <dd className="capitalize">{p.mode}</dd>
        </div>
      </dl>
      <table className="w-full text-[13px]">
        <thead className="border-y border-black text-[11px] uppercase tracking-wide">
          <tr>
            <th className="py-1 pr-2 text-left font-semibold">Particulars</th>
            <th className="py-1 pl-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/15">
          {(p.lines ?? []).map((line, i) => (
            <tr key={line.id ?? i}>
              <td className="py-1.5 pr-2">{EARNING_LABEL[line.earning_type]}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums">{formatMoney(line.amount)}</td>
            </tr>
          ))}
          <tr className="font-semibold">
            <td className="py-1.5 pr-2">Gross earnings</td>
            <td className="py-1.5 pl-2 text-right tabular-nums">{formatMoney(p.gross)}</td>
          </tr>
          {[
            ['Tax deducted at source (TDS)', p.tds_amount],
            ['Provident fund', p.pf_amount],
            ['Insurance', p.insurance_amount],
          ].map(
            ([label, amount]) =>
              Number(amount) > 0 && (
                <tr key={label as string}>
                  <td className="py-1.5 pr-2">Less: {label}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">
                    ({formatMoney(amount as string)})
                  </td>
                </tr>
              ),
          )}
        </tbody>
        <tfoot className="border-t-2 border-black">
          <tr className="text-base font-bold">
            <td className="py-2 pr-2">Net pay</td>
            <td className="py-2 pl-2 text-right tabular-nums">{formatMoney(p.net_paid)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-1 text-xs italic">{amountInWords(p.net_paid)}</p>
      {p.remarks && <p className="mt-2 text-xs">Remarks: {p.remarks}</p>}
      <footer className="mt-12 flex items-end justify-between text-xs">
        <span className="border-t border-black px-4 pt-1">Received by</span>
        <span className="border-t border-black px-4 pt-1">Accountant</span>
      </footer>
    </div>
  )
}
