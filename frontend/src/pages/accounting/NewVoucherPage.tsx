import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useCalendar } from '../../lib/billing'
import {
  PARTICULAR_CATEGORIES,
  VOUCHER_TYPE_LABEL,
  currentFiscalYear,
  useFiscalYears,
  useLedgerGroups,
  useLedgers,
  type BalanceSide,
  type Voucher,
  type VoucherType,
} from '../../lib/accounting'
import { formatMoney, sumAmounts } from '../../lib/format'
import {
  AmountInput,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  apiErrorMessage,
  useToast,
} from '../../components/ui'
import { IconCheck, IconPlus, IconTrash } from '../../components/icons'

/**
 * Voucher entry. The form mirrors how the books actually work instead of
 * asking the clerk to know it:
 *
 * - income/expense/contra: pick the cash/bank account the money moved
 *   through, then list the particulars — the server derives every Dr/Cr and
 *   prepends the balancing cash line, so these can never unbalance;
 * - journal: explicit Dr/Cr rows with a live balance meter — the submit
 *   button stays locked until Dr equals Cr (the database enforces it again).
 *
 * Ledger choices are pre-filtered per voucher type so an illegal pairing
 * (an asset ledger on an income voucher) is unpickable, not an error.
 */

interface DraftLine {
  key: number
  ledger: string
  side: BalanceSide
  amount: string
  remarks: string
}

let lineKey = 1

const newLine = (): DraftLine => ({ key: lineKey++, ledger: '', side: 'dr', amount: '', remarks: '' })

export default function NewVoucherPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const calendar = useCalendar()
  const fiscalYears = useFiscalYears()
  const groups = useLedgerGroups()
  const ledgers = useLedgers()

  const [type, setType] = useState<VoucherType>('income')
  const [fiscalYear, setFiscalYear] = useState('')
  const [dateBs, setDateBs] = useState('')
  const [cashLedger, setCashLedger] = useState('')
  const [mode, setMode] = useState<'cash' | 'bank'>('cash')
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([newLine()])

  useEffect(() => {
    if (calendar.data && !dateBs) setDateBs(calendar.data.today_bs)
  }, [calendar.data, dateBs])

  const openYears = (fiscalYears.data ?? []).filter((y) => !y.closed)
  const activeYear = fiscalYear || currentFiscalYear(fiscalYears.data)?.id || ''

  const categoryOf = useMemo(() => {
    const map = new Map((groups.data ?? []).map((g) => [g.code, g.category]))
    return (groupCode: number) => map.get(groupCode)
  }, [groups.data])

  // Cash/bank accounts live in asset groups; particulars per voucher type.
  const cashChoices = (ledgers.data ?? []).filter((l) => categoryOf(l.group) === 'asset')
  const particularChoices = useMemo(() => {
    const all = ledgers.data ?? []
    if (type === 'journal') return all
    if (type === 'contra') return all.filter((l) => categoryOf(l.group) === 'asset' && l.id !== cashLedger)
    return all.filter((l) => PARTICULAR_CATEGORIES[type].includes(categoryOf(l.group) ?? ''))
  }, [ledgers.data, type, cashLedger, categoryOf])

  const debit = sumAmounts(lines.filter((l) => l.side === 'dr').map((l) => l.amount))
  const credit = sumAmounts(lines.filter((l) => l.side === 'cr').map((l) => l.amount))
  const total = sumAmounts(lines.map((l) => l.amount))
  const isCashVoucher = type !== 'journal'
  const balanced = type !== 'journal' || (debit === credit && debit > 0)

  const filled = lines.filter((l) => l.ledger && Number(l.amount) > 0)
  const ready =
    !!activeYear &&
    !!dateBs &&
    filled.length === lines.length &&
    lines.length > 0 &&
    balanced &&
    (!isCashVoucher || !!cashLedger)

  function patch(key: number, changes: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...changes } : l)))
  }

  const create = useMutation({
    mutationFn: async () =>
      (
        await api.post<Voucher>('/api/v1/accounting/vouchers/', {
          voucher_type: type,
          date_bs: dateBs,
          fiscal_year: activeYear,
          cash_ledger: isCashVoucher ? cashLedger : null,
          mode: type === 'income' || type === 'expense' ? mode : '',
          remarks,
          lines: lines.map((l) => ({
            ledger: l.ledger,
            amount: l.amount,
            remarks: l.remarks,
            ...(type === 'journal' ? { side: l.side } : {}),
          })),
        })
      ).data,
    onSuccess: (voucher) => {
      queryClient.invalidateQueries({ queryKey: ['accounting', 'vouchers'] })
      toast.success(`Voucher ${voucher.number} posted.`)
      navigate('/accounting/vouchers')
    },
    onError: (error) => toast.error(apiErrorMessage(error)),
  })

  if (!fiscalYears.isLoading && openYears.length === 0) {
    return (
      <EmptyState
        title="No open fiscal year"
        hint="Create or reopen a fiscal year before entering vouchers."
      />
    )
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        {/* Type + header facts */}
        <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-surface-sunken p-1 sm:grid-cols-4">
            {(Object.keys(VOUCHER_TYPE_LABEL) as VoucherType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setType(t)
                  setLines([newLine()])
                  setCashLedger('')
                }}
                className={`h-9 rounded-md text-[13px] font-medium transition-colors ${
                  type === t ? 'bg-surface shadow-sm' : 'text-ink-muted hover:text-ink'
                }`}
              >
                {VOUCHER_TYPE_LABEL[t]}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Fiscal year">
              <Select value={activeYear} onChange={(e) => setFiscalYear(e.target.value)}>
                {openYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date (BS)">
              <Input value={dateBs} onChange={(e) => setDateBs(e.target.value)} placeholder="2083-03-22" />
            </Field>
            {(type === 'income' || type === 'expense') && (
              <Field label="Mode">
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-sunken p-1">
                  {(['cash', 'bank'] as const).map((m) => (
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
            )}
          </div>

          {isCashVoucher && (
            <Field
              label={
                type === 'contra'
                  ? 'Transfer from (source cash/bank account)'
                  : type === 'income'
                    ? 'Money received into'
                    : 'Money paid out of'
              }
              className="mt-3"
            >
              <Select value={cashLedger} onChange={(e) => setCashLedger(e.target.value)}>
                <option value="">Choose a cash or bank ledger…</option>
                {cashChoices.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} — {l.group_name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </section>

        {/* Lines */}
        <section className="rounded-xl border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold">
              {type === 'journal' ? 'Journal lines' : type === 'contra' ? 'Transfer to' : 'Particulars'}
            </h2>
            <Button variant="secondary" onClick={() => setLines((ls) => [...ls, newLine()])}>
              <IconPlus size={16} /> Add line
            </Button>
          </div>

          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <li
                key={line.key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_auto] sm:items-center sm:px-5"
              >
                <label className="col-span-2 block sm:col-span-1">
                  <span className="mb-1 block text-[11px] font-medium text-ink-faint sm:hidden">Ledger</span>
                  <Select
                    value={line.ledger}
                    aria-label="Ledger"
                    onChange={(e) => patch(line.key, { ledger: e.target.value })}
                  >
                    <option value="">Choose a ledger…</option>
                    {particularChoices.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} — {l.group_name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-ink-faint sm:hidden">Narration</span>
                  <Input
                    value={line.remarks}
                    aria-label="Narration"
                    placeholder="Narration (optional)"
                    onChange={(e) => patch(line.key, { remarks: e.target.value })}
                  />
                </label>
                <div className="flex items-center gap-2">
                  {type === 'journal' && (
                    <button
                      type="button"
                      aria-label={`Switch to ${line.side === 'dr' ? 'credit' : 'debit'}`}
                      onClick={() => patch(line.key, { side: line.side === 'dr' ? 'cr' : 'dr' })}
                      className={`h-10 w-12 shrink-0 rounded-lg border text-sm font-semibold transition-colors ${
                        line.side === 'dr'
                          ? 'border-accent bg-accent-soft text-accent-strong'
                          : 'border-warning/40 bg-warning-soft text-warning'
                      }`}
                    >
                      {line.side === 'dr' ? 'Dr' : 'Cr'}
                    </button>
                  )}
                  <AmountInput
                    value={line.amount}
                    aria-label="Amount"
                    onChange={(e) => patch(line.key, { amount: e.target.value })}
                  />
                </div>
                <button
                  type="button"
                  aria-label="Remove line"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}
                  className="flex size-9 items-center justify-center self-center rounded-lg text-ink-faint hover:bg-danger-soft hover:text-danger disabled:opacity-30"
                >
                  <IconTrash size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <Field label="Voucher remarks">
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      {/* Summary */}
      <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
        <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-semibold">Posting summary</h2>

          {type === 'journal' ? (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-muted">Debit total</dt>
                <dd className="tabular-nums">{formatMoney(debit)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-muted">Credit total</dt>
                <dd className="tabular-nums">{formatMoney(credit)}</dd>
              </div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <dt>Difference</dt>
                <dd className={`tabular-nums ${debit === credit ? 'text-positive' : 'text-danger'}`}>
                  {formatMoney(Math.abs(debit - credit))}
                </dd>
              </div>
            </dl>
          ) : (
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between font-semibold">
                <dt>{type === 'income' ? 'Total received' : type === 'expense' ? 'Total paid' : 'Total transferred'}</dt>
                <dd className="tabular-nums">{formatMoney(total)}</dd>
              </div>
              <p className="pt-1 text-xs text-ink-faint">
                The balancing {mode || 'cash'} line is written automatically — this voucher cannot
                unbalance the books.
              </p>
            </dl>
          )}

          {type === 'journal' && (
            <div className="mt-3">
              {balanced ? (
                <Badge tone="positive">
                  <IconCheck size={12} className="mr-1" /> Balanced
                </Badge>
              ) : (
                <Badge tone="warning">Dr and Cr must match</Badge>
              )}
            </div>
          )}

          <Button
            className="mt-4 h-11 w-full"
            busy={create.isPending}
            disabled={!ready}
            onClick={() => create.mutate()}
          >
            Post {VOUCHER_TYPE_LABEL[type].toLowerCase()} voucher
          </Button>
          <p className="mt-3 text-center text-xs text-ink-faint">
            Numbered automatically per fiscal year
          </p>
        </div>
      </aside>
    </div>
  )
}
