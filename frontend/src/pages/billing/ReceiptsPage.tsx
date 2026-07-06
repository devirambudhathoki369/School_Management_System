import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Paginated, Payment, StudentRow } from '../../lib/billing'
import { formatDateBS, formatMoney, formatReceiptNo } from '../../lib/format'
import StudentPicker from '../../components/StudentPicker'
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
import { IconPrinter, IconReceipt } from '../../components/icons'
import { PrintMirror, ReceiptSheet } from './ReceiptSheet'

/**
 * Receipt register: everything ever collected, filterable, reprintable.
 * Receipts are immutable (M2) — there is no edit path here by design; a
 * wrong receipt is corrected by issuing a counter-entry, not by rewriting
 * history.
 */

const PAGE_SIZE = 50

const MODE_TONE = {
  cash: 'neutral',
  bank: 'accent',
  cheque: 'warning',
  wallet: 'positive',
} as const

export default function ReceiptsPage() {
  const [kind, setKind] = useState('')
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'receipts', kind, student?.id ?? '', page],
    queryFn: async () =>
      (
        await api.get<Paginated<Payment>>('/api/v1/billing/payments/', {
          params: {
            page,
            kind: kind || undefined,
            student: student?.id || undefined,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
  })

  const detail = useQuery({
    queryKey: ['billing', 'receipt', openId],
    queryFn: async () => (await api.get<Payment>(`/api/v1/billing/payments/${openId}/`)).data,
    enabled: !!openId,
  })

  const rows = data?.results ?? []

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="sm:w-80">
          <StudentPicker value={student} onChange={(s) => { setStudent(s); setPage(1) }} placeholder="Filter by student…" />
        </div>
        <Select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value)
            setPage(1)
          }}
          aria-label="Receipt kind"
          className="h-11 sm:w-44"
        >
          <option value="">All receipts</option>
          <option value="regular">Student receipts</option>
          <option value="cash_receipt">Cash receipts</option>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<IconReceipt size={22} />}
            title="No receipts found"
            hint="Adjust the filters, or collect the first payment from the Collect tab."
          />
        ) : (
          <>
            {/* Table (md and up) */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-border bg-surface-muted text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">Receipt</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Received from</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 text-right font-medium">Discount</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setOpenId(p.id)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted"
                  >
                    <td className="px-4 py-3 font-medium tabular-nums">
                      {formatReceiptNo(p.receipt_no)}
                      {p.kind === 'cash_receipt' && (
                        <span className="ml-2 align-middle"><Badge>cash rcpt</Badge></span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{formatDateBS(p.date_bs)}</td>
                    <td className="px-4 py-3">{p.student_name ?? p.payer_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={MODE_TONE[p.mode]}>{p.mode}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right text-ink-muted">
                      <Money value={p.total_discount ?? 0} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      <Money value={p.total_paid} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cards (below md) */}
            <ul className="divide-y divide-border md:hidden">
              {rows.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => setOpenId(p.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {p.student_name ?? p.payer_name ?? 'Receipt'}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        #{formatReceiptNo(p.receipt_no)} · {formatDateBS(p.date_bs)} · {p.mode}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatMoney(p.total_paid)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {data && (
        <Pagination
          count={data.count}
          page={page}
          pageSize={PAGE_SIZE}
          onPage={setPage}
          label="receipts"
        />
      )}

      <Modal
        open={!!openId}
        onClose={() => setOpenId(null)}
        title={detail.data ? `Receipt ${formatReceiptNo(detail.data.receipt_no)}` : 'Receipt'}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpenId(null)}>
              Close
            </Button>
            <Button onClick={() => window.print()} disabled={!detail.data}>
              <IconPrinter size={16} /> Print
            </Button>
          </>
        }
      >
        {detail.isLoading && <SkeletonRows rows={4} />}
        {detail.data && (
          <>
            <div className="overflow-hidden rounded-lg border border-border">
              <ReceiptSheet
                payment={detail.data}
                studentName={detail.data.student_name ?? undefined}
              />
            </div>
            <PrintMirror>
              <ReceiptSheet
                payment={detail.data}
                studentName={detail.data.student_name ?? undefined}
              />
            </PrintMirror>
          </>
        )}
      </Modal>
    </div>
  )
}
