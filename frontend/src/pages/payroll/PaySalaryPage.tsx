import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { currentBillingYear, useBillingYears, useCalendar, useYearPointers } from '../../lib/billing'
import {
  EARNING_LABEL,
  EARNING_TYPES,
  useHeadBalances,
  type EarningType,
  type SalaryPayment,
} from '../../lib/payroll'
import { BS_MONTHS, formatMoney } from '../../lib/format'
import StaffSelect from '../../components/StaffSelect'
import {
  AmountInput,
  Button,
  Field,
  Input,
  Money,
  Select,
  StatCard,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconCheck, IconWallet } from '../../components/icons'

/**
 * Salary payment entry. A line's amount is the GROSS settled against that
 * earning head; TDS/PF/insurance are withholdings, so the net identity
 * net = gross − TDS − PF − insurance is shown live and enforced again by
 * a database check constraint — the voucher-grade guarantee, for payroll.
 */

const MODES = ['cash', 'bank', 'cheque', 'wallet'] as const

export default function PaySalaryPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const calendar = useCalendar()
  const billingYears = useBillingYears()
  const pointers = useYearPointers()

  const [staff, setStaff] = useState('')
  const [amounts, setAmounts] = useState<Record<EarningType, string>>({
    salary: '', grade: '', allowance: '', extra: '',
  })
  const [tds, setTds] = useState('')
  const [pf, setPf] = useState('')
  const [insurance, setInsurance] = useState('')
  const [dateBs, setDateBs] = useState('')
  const [month, setMonth] = useState(0)
  const [mode, setMode] = useState<(typeof MODES)[number]>('cash')
  const [remarks, setRemarks] = useState('')
  const [completed, setCompleted] = useState<SalaryPayment | null>(null)

  const balances = useHeadBalances(staff || null)

  useEffect(() => {
    if (calendar.data && !dateBs) {
      setDateBs(calendar.data.today_bs)
      setMonth(Number(calendar.data.today_bs.split('-')[1]) || 0)
    }
  }, [calendar.data, dateBs])

  const billingYear = currentBillingYear(billingYears.data, calendar.data?.today_bs)
  const academicYear = pointers.data?.[0]?.academic_year ?? null

  const gross = useMemo(
    () => EARNING_TYPES.reduce((acc, head) => acc + (Number(amounts[head]) || 0), 0),
    [amounts],
  )
  const net = gross - (Number(tds) || 0) - (Number(pf) || 0) - (Number(insurance) || 0)
  const ready = !!staff && gross > 0 && net >= 0 && !!dateBs && !!billingYear && !!academicYear

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post<SalaryPayment>('/api/v1/payroll/payments/', {
          staff,
          date_bs: dateBs,
          academic_year: academicYear,
          billing_year: billingYear!.id,
          payment_month: month,
          mode,
          pf_amount: pf || '0',
          insurance_amount: insurance || '0',
          remarks,
          lines: EARNING_TYPES.filter((head) => Number(amounts[head]) > 0).map((head, i) => ({
            earning_type: head,
            amount: amounts[head],
            // legacy convention: the withholding rides on the first line
            tds_amount: i === 0 ? tds || '0' : '0',
          })),
        })
      ).data,
    onSuccess: (payment) => {
      setCompleted(payment)
      queryClient.invalidateQueries({ queryKey: ['payroll'] })
      toast.success(`Salary paid — Rs. ${formatMoney(payment.net_paid)} net.`)
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  if (completed) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border bg-surface p-6 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-positive-soft text-positive">
          <IconCheck size={24} />
        </div>
        <h2 className="text-lg font-semibold">
          Payment #{completed.serial} — {completed.staff_name}
        </h2>
        <dl className="mx-auto mt-4 max-w-xs space-y-1.5 text-sm">
          <Row label="Gross" value={completed.gross} />
          <Row label="TDS withheld" value={completed.tds_amount} />
          <Row label="PF" value={completed.pf_amount ?? 0} />
          <Row label="Insurance" value={completed.insurance_amount ?? 0} />
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>Net paid</dt>
            <dd className="tabular-nums">{formatMoney(completed.net_paid)}</dd>
          </div>
        </dl>
        <Button
          className="mt-5"
          onClick={() => {
            setCompleted(null)
            setStaff('')
            setAmounts({ salary: '', grade: '', allowance: '', extra: '' })
            setTds('')
            setPf('')
            setInsurance('')
            setRemarks('')
          }}
        >
          New payment
        </Button>
      </div>
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold">Who is being paid</h2>
          <StaffSelect value={staff} onChange={setStaff} autoFocus />
        </section>

        {staff && (
          <section className="rounded-xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-3 sm:px-5">
              <h2 className="text-sm font-semibold">
                Earning heads{' '}
                <span className="font-normal text-ink-muted">— gross amount settled per head</span>
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {EARNING_TYPES.map((head) => {
                const owed = balances.data ? Number(balances.data[head]) : null
                return (
                  <li
                    key={head}
                    className="grid grid-cols-2 items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_130px_160px] sm:px-5"
                  >
                    <div>
                      <p className="text-sm font-medium">{EARNING_LABEL[head]}</p>
                      {owed !== null && (
                        <p className={`text-xs ${owed > 0 ? 'text-warning' : 'text-ink-faint'}`}>
                          {owed > 0 ? `Rs. ${formatMoney(owed)} outstanding` : 'settled'}
                        </p>
                      )}
                    </div>
                    <AmountInput
                      value={amounts[head]}
                      aria-label={`${EARNING_LABEL[head]} amount`}
                      onChange={(e) => setAmounts((a) => ({ ...a, [head]: e.target.value }))}
                    />
                    <div className="hidden justify-end sm:flex">
                      {owed !== null && owed > 0 && (
                        <button
                          type="button"
                          className="text-xs font-medium text-accent-strong hover:underline"
                          onClick={() => setAmounts((a) => ({ ...a, [head]: String(owed) }))}
                        >
                          settle in full
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {staff && (
          <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Withholdings</h2>
            <div className="grid grid-cols-3 gap-3">
              <Field label="TDS">
                <AmountInput value={tds} onChange={(e) => setTds(e.target.value)} />
              </Field>
              <Field label="Provident fund">
                <AmountInput value={pf} onChange={(e) => setPf(e.target.value)} />
              </Field>
              <Field label="Insurance">
                <AmountInput value={insurance} onChange={(e) => setInsurance(e.target.value)} />
              </Field>
            </div>
          </section>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
        {staff && balances.data && (
          <StatCard
            label="Outstanding to this staff"
            value={<Money value={balances.data.total} />}
            detail="accrued minus settled, all heads"
            icon={<IconWallet size={16} />}
          />
        )}

        <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold">Payment details</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date (BS)">
              <Input value={dateBs} onChange={(e) => setDateBs(e.target.value)} />
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
            <Row label="Gross" value={gross} />
            <Row label="Withheld" value={(Number(tds) || 0) + (Number(pf) || 0) + (Number(insurance) || 0)} />
            <div className={`flex justify-between text-base font-semibold ${net < 0 ? 'text-danger' : ''}`}>
              <dt>Net to pay</dt>
              <dd className="tabular-nums">{formatMoney(net)}</dd>
            </div>
          </dl>

          <Button
            className="mt-4 h-11 w-full"
            busy={create.isPending}
            disabled={!ready}
            onClick={() => create.mutate()}
          >
            Pay Rs. {formatMoney(Math.max(net, 0))}
          </Button>
          {net < 0 && (
            <p className="mt-2 text-xs text-danger">Withholdings exceed the gross amount.</p>
          )}
        </div>
      </aside>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between text-ink-muted">
      <dt>{label}</dt>
      <dd className="tabular-nums">{formatMoney(value)}</dd>
    </div>
  )
}
