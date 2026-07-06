import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../../lib/auth'
import type { Payment } from '../../lib/billing'
import {
  bsMonthName,
  formatDateBS,
  formatMoney,
  formatReceiptNo,
  sumAmounts,
} from '../../lib/format'

/**
 * The printable fee receipt. Rendered twice from the same markup: an
 * on-screen preview, and a copy portaled into #print-root so window.print()
 * emits only the receipt (index.css hides the app shell whenever the portal
 * has content). Deliberately monochrome and dense — this goes on paper.
 */

export function ReceiptSheet({
  payment,
  studentName,
  classLabel,
}: {
  payment: Payment
  studentName?: string
  classLabel?: string
}) {
  const { account } = useAuth()
  const school = account?.school
  const lines = payment.lines ?? []
  // Settled = cash + waived (M1): what the dues balance actually drops by.
  const settled = sumAmounts(lines.map((l) => l.discount)) + Number(payment.total_paid)

  return (
    <div className="bg-white p-6 text-[13px] leading-snug text-black">
      <header className="border-b-2 border-black pb-3 text-center">
        <h1 className="text-lg font-bold uppercase tracking-wide">{school?.name}</h1>
        {school?.address && <p>{school.address}</p>}
        <p className="text-xs">
          {school?.contact && <>Tel: {school.contact}</>}
          {school?.pan_no && <> · PAN: {school.pan_no}</>}
        </p>
        <p className="mt-2 text-sm font-semibold uppercase">
          {payment.kind === 'cash_receipt' ? 'Cash Receipt' : 'Fee Receipt'}
        </p>
      </header>

      <div className="mt-3 flex flex-wrap justify-between gap-x-6 gap-y-1">
        <p>
          <span className="font-semibold">Receipt No:</span>{' '}
          {formatReceiptNo(payment.serial ?? payment.legacy_serial)}
        </p>
        <p>
          <span className="font-semibold">Date:</span> {formatDateBS(payment.date_bs)}
        </p>
        {payment.payment_month > 0 && (
          <p>
            <span className="font-semibold">Month:</span> {bsMonthName(payment.payment_month)}
          </p>
        )}
        <p className="capitalize">
          <span className="font-semibold">Mode:</span> {payment.mode}
        </p>
      </div>

      <div className="mt-1 flex flex-wrap justify-between gap-x-6 gap-y-1">
        {payment.kind === 'regular' ? (
          <>
            <p>
              <span className="font-semibold">Student:</span> {studentName ?? '—'}
            </p>
            {classLabel && (
              <p>
                <span className="font-semibold">Class:</span> {classLabel}
              </p>
            )}
          </>
        ) : (
          <p>
            <span className="font-semibold">Received from:</span> {payment.payer_name || '—'}
            {payment.payer_address ? `, ${payment.payer_address}` : ''}
          </p>
        )}
      </div>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-1.5 pr-2 font-semibold">#</th>
            <th className="py-1.5 pr-2 font-semibold">Particulars</th>
            <th className="py-1.5 pl-2 text-right font-semibold">Discount</th>
            <th className="py-1.5 pl-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={line.id ?? i} className="border-b border-dotted border-black/40">
              <td className="py-1 pr-2 align-top">{i + 1}</td>
              <td className="py-1 pr-2">{line.label}</td>
              <td className="py-1 pl-2 text-right tabular-nums">
                {Number(line.discount) > 0 ? formatMoney(line.discount) : '—'}
              </td>
              <td className="py-1 pl-2 text-right tabular-nums">{formatMoney(line.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {Number(payment.total_discount) > 0 && (
            <tr>
              <td colSpan={3} className="py-1 pl-2 text-right">
                Discount allowed
              </td>
              <td className="py-1 pl-2 text-right tabular-nums">
                {formatMoney(payment.total_discount)}
              </td>
            </tr>
          )}
          <tr className="border-t border-black font-bold">
            <td colSpan={3} className="py-1.5 pl-2 text-right">
              Amount received (Rs.)
            </td>
            <td className="py-1.5 pl-2 text-right tabular-nums">
              {formatMoney(payment.total_paid)}
            </td>
          </tr>
          {payment.kind === 'regular' && Number(payment.total_discount) > 0 && (
            <tr className="text-xs">
              <td colSpan={4} className="pt-1 text-right italic">
                Settled against dues: Rs. {formatMoney(settled)}
              </td>
            </tr>
          )}
        </tfoot>
      </table>

      {payment.remarks && <p className="mt-3 text-xs">Remarks: {payment.remarks}</p>}

      <footer className="mt-10 flex justify-between text-xs">
        <p>Printed from School ERP</p>
        <p className="border-t border-black px-6 pt-1">Authorised signature</p>
      </footer>
    </div>
  )
}

/** Mirrors children into #print-root while mounted, so Ctrl/Cmd+P or the
 *  Print button emits just the receipt. */
export function PrintMirror({ children }: { children: React.ReactNode }) {
  const root = useMemo(() => {
    let el = document.getElementById('print-root')
    if (!el) {
      el = document.createElement('div')
      el.id = 'print-root'
      document.body.appendChild(el)
    }
    return el
  }, [])

  return createPortal(children, root)
}
