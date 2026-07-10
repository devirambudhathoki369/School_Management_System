import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { fetchAllPages } from './billing'

/** Types + lookups for the accounting workspace. */

export type BalanceSide = 'dr' | 'cr'
export type VoucherType = 'income' | 'expense' | 'journal' | 'contra'

export interface FiscalYear {
  id: string
  name: string
  start_date_bs: string
  end_date_bs: string
  closed: boolean
  previous: string | null
  remarks: string
}

export interface LedgerGroup {
  code: number
  name: string
  natural_side: BalanceSide
  category: 'income' | 'expense' | 'asset' | 'liability' | 'equity'
  cash_flow: string
}

export interface LedgerAccount {
  id: string
  name: string
  group: number
  group_name: string
  address: string
  contact: string
}

export interface VoucherLine {
  id?: string
  ledger: string
  ledger_name?: string
  side?: BalanceSide
  amount: string
  remarks?: string
}

export interface Voucher {
  id: string
  voucher_type: VoucherType
  serial: number
  number: string
  date_bs: string
  fiscal_year: string
  cash_ledger: string | null
  mode: 'cash' | 'bank' | ''
  remarks: string
  needs_review: boolean
  lines?: VoucherLine[]
}

export interface TrialBalanceRow {
  id: string
  ledger: string
  opening_debit: string
  opening_credit: string
  debit: string
  credit: string
  closing_debit: string
  closing_credit: string
}

export interface TrialBalanceGroup {
  group: string
  group_opening_debit: string
  group_opening_credit: string
  group_debit: string
  group_credit: string
  group_closing_debit: string
  group_closing_credit: string
  ledgers: TrialBalanceRow[]
}

export interface TrialBalance {
  data: TrialBalanceGroup[]
  total_opening_debit: string
  total_opening_credit: string
  total_debit: string
  total_credit: string
  total_closing_debit: string
  total_closing_credit: string
}

export interface StatementLedgerRow {
  id: string
  ledger: string
  amount: string
}

export interface StatementGroup {
  code: number
  group: string
  total: string
  ledgers: StatementLedgerRow[]
}

export interface IncomeStatement {
  income: StatementGroup[]
  expense: StatementGroup[]
  total_income: string
  total_expense: string
  net: string
}

export interface BalanceSheet {
  assets: StatementGroup[]
  liabilities: StatementGroup[]
  equity: StatementGroup[]
  net_profit: string
  total_assets: string
  total_liabilities: string
  total_equity: string
  balanced: boolean
}

export interface StatementEntry {
  kind: 'opening' | 'voucher'
  voucher?: string
  date_bs?: string
  side: BalanceSide | null
  amount: string
  ledger: string
  narration?: string
}

/** Which ledger categories may appear as particulars (server re-validates;
 *  the form pre-filters so a clerk never sees an illegal choice). */
export const PARTICULAR_CATEGORIES: Record<'income' | 'expense', string[]> = {
  income: ['income', 'liability', 'equity'],
  expense: ['expense', 'liability'],
}

export const VOUCHER_TYPE_LABEL: Record<VoucherType, string> = {
  income: 'Income',
  expense: 'Expense',
  journal: 'Journal',
  contra: 'Contra',
}

export function useFiscalYears() {
  return useQuery({
    queryKey: ['accounting', 'fiscal-years'],
    queryFn: () => fetchAllPages<FiscalYear>('/api/v1/accounting/fiscal-years/'),
    staleTime: 10 * 60 * 1000,
  })
}

/** The working fiscal year: newest open one (list is ordered newest-first). */
export function currentFiscalYear(years: FiscalYear[] | undefined): FiscalYear | undefined {
  return years?.find((y) => !y.closed) ?? years?.[0]
}

export function useLedgerGroups() {
  return useQuery({
    queryKey: ['accounting', 'groups'],
    queryFn: async () => (await api.get<LedgerGroup[]>('/api/v1/accounting/groups/')).data,
    staleTime: 60 * 60 * 1000,
  })
}

export function useLedgers() {
  return useQuery({
    queryKey: ['accounting', 'ledgers'],
    queryFn: () => fetchAllPages<LedgerAccount>('/api/v1/accounting/ledgers/'),
  })
}
