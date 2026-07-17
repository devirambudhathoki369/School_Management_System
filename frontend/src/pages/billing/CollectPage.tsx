import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import {
  currentBillingYear,
  discountValue,
  useBillingYears,
  useCalendar,
  useEducationFeeLevels,
  useFeeSchedules,
  useStudentDetail,
  useStudentDiscounts,
  useStudentDues,
  useYearPointers,
  type LineType,
  type Payment,
  type StudentRow,
} from '../../lib/billing'
import { BS_MONTHS, formatMoney, formatReceiptNo, sumAmounts } from '../../lib/format'
import StudentPicker from '../../components/StudentPicker'
import {
  AmountInput,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Money,
  Select,
  Skeleton,
  StatCard,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import {
  IconCheck,
  IconPlus,
  IconPrinter,
  IconReceipt,
  IconTrash,
  IconWallet,
} from '../../components/icons'
import { PrintMirror, ReceiptSheet } from './ReceiptSheet'

/**
 * Receipt entry — the desk a school clerk sits at all day, so the flow is
 * strictly top-to-bottom: pick the student, tap fees from the class fee plan
 * (standing discounts pre-applied, percentage-wins rule), adjust, collect.
 *
 * Money semantics (M1): a line's `amount` is the cash tendered against that
 * particular and `discount` is what was waived now; together they settle
 * dues. total_paid/total_discount are recomputed server-side from lines.
 */

interface DraftLine {
  key: number
  line_type: LineType
  fee_title: string | null
  label: string
  amount: string
  discount: string
}

const MODES = ['cash', 'bank', 'cheque', 'wallet'] as const

let lineKey = 1

export default function CollectPage() {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [kind, setKind] = useState<'regular' | 'cash_receipt'>('regular')
  const [student, setStudent] = useState<StudentRow | null>(null)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [dateBs, setDateBs] = useState('')
  const [month, setMonth] = useState(0)
  const [mode, setMode] = useState<(typeof MODES)[number]>('cash')
  const [remarks, setRemarks] = useState('')
  const [payerName, setPayerName] = useState('')
  const [payerAddress, setPayerAddress] = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [completed, setCompleted] = useState<{ payment: Payment; student: StudentRow | null } | null>(null)

  const calendar = useCalendar()
  const billingYears = useBillingYears()
  const pointers = useYearPointers()
  const detail = useStudentDetail(student?.id ?? null)
  const dues = useStudentDues(student?.id ?? null)
  const schedules = useFeeSchedules(kind === 'regular' ? (student?.class_info ?? null) : null)
  const discounts = useStudentDiscounts(student?.id ?? null)

  // Defaults arrive async: today's BS date drives both the date field and
  // the month the receipt is booked against.
  useEffect(() => {
    if (calendar.data && !dateBs) {
      setDateBs(calendar.data.today_bs)
      setMonth(Number(calendar.data.today_bs.split('-')[1]) || 0)
    }
  }, [calendar.data, dateBs])

  const billingYear = currentBillingYear(billingYears.data, calendar.data?.today_bs)
  const academicYear = detail.data?.academic_year ?? pointers.data?.[0]?.academic_year ?? null

  const totalAmount = sumAmounts(lines.map((l) => l.amount))
  const totalDiscount = sumAmounts(lines.map((l) => l.discount))
  const duesNow = dues.data ? Number(dues.data.dues) : null
  const duesAfter = duesNow === null ? null : duesNow - totalAmount - totalDiscount

  // Education Equality Fee (3% government levy) preview. Mirrors the server:
  // regular receipts only, levied where the vendor enabled the student's
  // education level; base is net-after-discount, collected ON TOP of the
  // receipt (never inside its totals).
  const eduLevels = useEducationFeeLevels()
  const eduFeeApplies =
    kind === 'regular' &&
    !!detail.data?.education_level &&
    (eduLevels.data?.enabled ?? []).includes(detail.data.education_level)
  const eduFeeBase = lines.reduce((sum, l) => {
    if (l.line_type === 'discount') return sum
    const net = Number(l.amount || 0) - Number(l.discount || 0)
    return net > 0 ? sum + net : sum
  }, 0)
  const eduFee = eduFeeApplies ? Math.round(eduFeeBase * 3) / 100 : 0

  function resetDraft() {
    setLines([])
    setRemarks('')
    setPayerName('')
    setPayerAddress('')
    setCustomLabel('')
  }

  function addScheduleLine(feeTitle: string, label: string, amount: string) {
    const standing = discounts.data?.find((d) => d.fee_title === feeTitle)
    const discount = standing ? discountValue(standing, amount) : 0
    setLines((ls) => [
      ...ls,
      {
        key: lineKey++,
        line_type: 'fee',
        fee_title: feeTitle,
        label,
        amount: String(Math.max(0, Number(amount) - discount)),
        discount: discount ? String(discount) : '0',
      },
    ])
  }

  function addCustomLine(lineType: LineType, label: string) {
    setLines((ls) => [
      ...ls,
      { key: lineKey++, line_type: lineType, fee_title: null, label, amount: '0', discount: '0' },
    ])
  }

  function patchLine(key: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  const create = useMutation({
    mutationFn: async () => {
      const payload = {
        kind,
        date_bs: dateBs,
        student: kind === 'regular' ? student!.id : null,
        academic_year: academicYear,
        billing_year: billingYear!.id,
        payment_month: month,
        mode,
        remarks,
        payer_name: payerName,
        payer_address: payerAddress,
        lines: lines.map(({ line_type, fee_title, label, amount, discount }) => ({
          line_type,
          fee_title,
          label,
          amount: amount || '0',
          discount: discount || '0',
        })),
      }
      return (await api.post<Payment>('/api/v1/billing/payments/', payload)).data
    },
    onSuccess: (payment) => {
      setCompleted({ payment, student })
      resetDraft()
      setStudent(null)
      queryClient.invalidateQueries({ queryKey: ['billing', 'dues'] })
      queryClient.invalidateQueries({ queryKey: ['billing', 'receipts'] })
      toast.success(
        `Receipt ${formatReceiptNo(payment.serial)} — Rs. ${formatMoney(payment.total_paid)} received.`,
      )
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  const problems = useMemo(() => {
    const list: string[] = []
    if (kind === 'regular' && !student) list.push('Pick a student.')
    if (kind === 'cash_receipt' && !payerName.trim()) list.push('Who paid? Payer name is required.')
    if (lines.length === 0) list.push('Add at least one line.')
    if (lines.some((l) => !l.label.trim())) list.push('Every line needs a particular.')
    if (lines.some((l) => Number(l.amount) < 0 || Number(l.discount) < 0))
      list.push('Amounts cannot be negative.')
    if (totalAmount + totalDiscount <= 0) list.push('The receipt is empty.')
    if (!dateBs) list.push('Set the receipt date.')
    if (!billingYear) list.push('No open fiscal year is configured.')
    if (!academicYear) list.push('No running academic year found.')
    return list
  }, [kind, student, payerName, lines, totalAmount, totalDiscount, dateBs, billingYear, academicYear])

  // ---------------------------------------------------------- success view

  if (completed) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-positive-soft text-positive">
            <IconCheck size={24} />
          </div>
          <h2 className="text-lg font-semibold">
            Receipt {formatReceiptNo(completed.payment.serial)} issued
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Rs. {formatMoney(completed.payment.total_paid)} received
            {completed.student ? ` from ${completed.student.full_name}` : ''}.
            {Number(completed.payment.edu_fee_amount) > 0 &&
              ` Plus Rs. ${formatMoney(completed.payment.edu_fee_amount!)} Education Equality Fee (3% govt. levy).`}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => window.print()}>
              <IconPrinter size={16} /> Print receipt
            </Button>
            <Button variant="secondary" onClick={() => setCompleted(null)}>
              <IconPlus size={16} /> New receipt
            </Button>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-border shadow-sm">
          <ReceiptSheet
            payment={completed.payment}
            studentName={completed.student?.full_name}
            classLabel={completed.student?.class_label}
          />
        </div>
        <PrintMirror>
          <ReceiptSheet
            payment={completed.payment}
            studentName={completed.student?.full_name}
            classLabel={completed.student?.class_label}
          />
        </PrintMirror>
      </div>
    )
  }

  // ----------------------------------------------------------- entry form

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        {/* Who is paying */}
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Receipt for</h2>
            <div className="flex rounded-lg bg-surface-sunken p-0.5">
              {(
                [
                  ['regular', 'Student'],
                  ['cash_receipt', 'Cash receipt'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setKind(value)
                    resetDraft()
                  }}
                  className={`h-8 rounded-md px-3 text-[13px] font-medium transition-colors ${
                    kind === value ? 'bg-surface shadow-sm' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {kind === 'regular' ? (
            <StudentPicker value={student} onChange={(s) => { setStudent(s); setLines([]) }} autoFocus />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Received from">
                <Input
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  placeholder="Payer name"
                />
              </Field>
              <Field label="Address">
                <Input
                  value={payerAddress}
                  onChange={(e) => setPayerAddress(e.target.value)}
                  placeholder="Optional"
                />
              </Field>
            </div>
          )}
        </section>

        {/* Fee plan quick-add */}
        {kind === 'regular' && student && (
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">
              Class fee plan{' '}
              <span className="font-normal text-ink-muted">— tap to add to the receipt</span>
            </h2>
            {schedules.isLoading ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Skeleton className="h-11" />
                <Skeleton className="h-11" />
              </div>
            ) : (schedules.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-ink-muted">
                No fee plan is defined for this class yet — add custom lines below, or set the
                plan under the Fee plan tab.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {schedules.data!.map((fee) => {
                  const added = lines.some((l) => l.fee_title === fee.fee_title)
                  const standing = discounts.data?.find((d) => d.fee_title === fee.fee_title)
                  return (
                    <button
                      key={fee.id}
                      type="button"
                      disabled={added}
                      onClick={() => addScheduleLine(fee.fee_title, fee.title_name, fee.amount)}
                      className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:border-accent hover:bg-accent-soft/40 disabled:cursor-default disabled:border-border disabled:bg-surface-sunken disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{fee.title_name}</span>
                        {standing && (
                          <span className="block text-xs text-positive">
                            discount {standing.percentage ? `${Number(standing.percentage)}%` : `Rs. ${formatMoney(standing.flat_amount)}`}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-ink-muted">
                        {added ? 'added' : formatMoney(fee.amount)}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        )}

        {/* Receipt lines */}
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold">Receipt lines</h2>
            {lines.length > 0 && (
              <span className="text-xs text-ink-muted">{lines.length} line{lines.length > 1 ? 's' : ''}</span>
            )}
          </div>

          {lines.length === 0 ? (
            <EmptyState
              icon={<IconReceipt size={22} />}
              title="Nothing on this receipt yet"
              hint={
                kind === 'regular'
                  ? 'Tap fees from the class plan above or add a custom line.'
                  : 'Add a line for whatever is being received.'
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {lines.map((line) => (
                <li key={line.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_130px_130px_auto] sm:items-center sm:px-5">
                  <div className="col-span-2 sm:col-span-1">
                    {line.fee_title ? (
                      <>
                        <p className="truncate text-sm font-medium">{line.label}</p>
                        <p className="text-xs text-ink-faint capitalize">{line.line_type.replace(/_/g, ' ')}</p>
                      </>
                    ) : (
                      <Input
                        value={line.label}
                        aria-label="Particular"
                        onChange={(e) => patchLine(line.key, { label: e.target.value })}
                        placeholder="Particular"
                      />
                    )}
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-ink-faint sm:hidden">Amount</span>
                    <AmountInput
                      value={line.amount}
                      aria-label={`Amount for ${line.label || 'line'}`}
                      onChange={(e) => patchLine(line.key, { amount: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium text-ink-faint sm:hidden">Discount</span>
                    <AmountInput
                      value={line.discount}
                      aria-label={`Discount for ${line.label || 'line'}`}
                      onChange={(e) => patchLine(line.key, { discount: e.target.value })}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Remove ${line.label || 'line'}`}
                    onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                    className="flex size-9 items-center justify-center self-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger"
                  >
                    <IconTrash size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Custom line */}
          <form
            className="flex gap-2 border-t border-border px-4 py-3 sm:px-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (!customLabel.trim()) return
              addCustomLine('other', customLabel.trim())
              setCustomLabel('')
            }}
          >
            <Input
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              placeholder="Add a custom particular (old dues, fine, admission…)"
            />
            <Button type="submit" variant="secondary" disabled={!customLabel.trim()}>
              <IconPlus size={16} /> Add
            </Button>
          </form>
        </section>
      </div>

      {/* Summary / collect panel */}
      <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
        {kind === 'regular' && student && (
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Outstanding dues"
              value={dues.isLoading ? '…' : <Money value={duesNow} />}
              icon={<IconWallet size={16} />}
            />
            <StatCard
              label="Dues after receipt"
              value={duesAfter === null ? '…' : <Money value={duesAfter} />}
              detail={duesAfter !== null && duesAfter < 0 ? 'Advance / prepaid' : undefined}
            />
          </div>
        )}

        {eduFeeApplies && eduFee > 0 && (
          <div className="rounded-xl border border-accent-soft bg-accent-soft/40 px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">Education Equality Fee (3%)</span>
              <span className="font-semibold tabular-nums">Rs. {formatMoney(eduFee)}</span>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              Government levy collected on top of this receipt — not part of the
              student&apos;s dues or the school&apos;s income.
            </p>
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold">Payment details</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date (BS)">
              <Input value={dateBs} onChange={(e) => setDateBs(e.target.value)} placeholder="2082-03-21" />
            </Field>
            <Field label="For month">
              <Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                <option value={0}>—</option>
                {BS_MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Mode" className="mt-3">
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-surface-sunken p-1">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`h-8 rounded-md text-[13px] font-medium capitalize transition-colors ${
                    mode === m ? 'bg-surface shadow-sm' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Remarks" className="mt-3">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
          </Field>

          <dl className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
            <div className="flex justify-between text-ink-muted">
              <dt>Discount given</dt>
              <dd><Money value={totalDiscount} /></dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Cash to receive</dt>
              <dd><Money value={totalAmount} /></dd>
            </div>
          </dl>

          <Button
            className="mt-4 h-11 w-full"
            busy={create.isPending}
            disabled={problems.length > 0}
            onClick={() => create.mutate()}
          >
            Collect Rs. {formatMoney(totalAmount)}
          </Button>
          {problems.length > 0 && lines.length > 0 && (
            <p className="mt-2 text-xs text-warning">{problems[0]}</p>
          )}
          {billingYear && (
            <p className="mt-3 text-center text-xs text-ink-faint">
              Fiscal year {billingYear.name} · receipt number assigned on save
            </p>
          )}
        </div>

        {kind === 'regular' && student && (
          <div className="rounded-xl border border-border bg-surface p-4 text-sm sm:p-5">
            <p className="font-medium">{student.full_name}</p>
            <p className="mt-0.5 text-ink-muted">{student.class_label}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {student.roll_no && <Badge>Roll {student.roll_no}</Badge>}
              <Badge tone={student.status === 'running' ? 'accent' : 'warning'}>
                {student.status.replace(/_/g, ' ')}
              </Badge>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}
