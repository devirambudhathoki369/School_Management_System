import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { Paginated } from '../../lib/billing'
import { EARNING_LABEL, type SalaryAccrual } from '../../lib/payroll'
import { bsMonthName, formatDateBS, formatMoney } from '../../lib/format'
import StaffSelect from '../../components/StaffSelect'
import { EmptyState, Modal, Pagination, SkeletonRows } from '../../components/ui'
import { IconLayers } from '../../components/icons'

/** Accrual register: what each payroll run owes each staff member. */

const PAGE_SIZE = 50

export default function PostingsPage() {
  const [staff, setStaff] = useState('')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'accruals', staff, page],
    queryFn: async () =>
      (
        await api.get<Paginated<SalaryAccrual>>('/api/v1/payroll/accruals/', {
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
            icon={<IconLayers size={22} />}
            title="No salary postings found"
            hint="Run payroll to accrue what the school owes its staff."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setOpenId(a.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-muted sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.staff_name}</p>
                    <p className="text-xs text-ink-muted">
                      {formatDateBS(a.date_bs)} · {a.months.map(bsMonthName).join(', ')}
                      {a.remarks && <> · {a.remarks}</>}
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{formatMoney(a.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data && (
        <Pagination count={data.count} page={page} pageSize={PAGE_SIZE} onPage={setPage} label="postings" />
      )}

      <AccrualDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  )
}

function AccrualDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ['payroll', 'accrual', id],
    queryFn: async () => (await api.get<SalaryAccrual>(`/api/v1/payroll/accruals/${id}/`)).data,
    enabled: !!id,
  })
  const a = detail.data

  return (
    <Modal open={!!id} onClose={onClose} title={a ? `Posting — ${a.staff_name}` : 'Posting'}>
      {detail.isLoading && <SkeletonRows rows={3} />}
      {a && (
        <div className="space-y-4">
          <p className="text-sm text-ink-muted">
            {formatDateBS(a.date_bs)} · {a.months.map(bsMonthName).join(', ')}
          </p>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <tbody>
                {(a.lines ?? []).map((line, i) => (
                  <tr key={line.id ?? i} className="border-b border-border">
                    <td className="px-3 py-2">{EARNING_LABEL[line.earning_type]}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(line.amount)}</td>
                  </tr>
                ))}
                <tr className="bg-surface-muted font-semibold">
                  <td className="px-3 py-2">Total accrued</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(a.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {a.remarks && <p className="text-sm text-ink-muted">Remarks: {a.remarks}</p>}
        </div>
      )}
    </Modal>
  )
}
