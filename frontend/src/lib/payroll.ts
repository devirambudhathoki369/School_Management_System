import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { fetchAllPages } from './billing'

/** Types + lookups for the payroll workspace. */

export type EarningType = 'salary' | 'grade' | 'allowance' | 'extra'

export const EARNING_LABEL: Record<EarningType, string> = {
  salary: 'Basic salary',
  grade: 'Grade',
  allowance: 'Allowance',
  extra: 'Extra',
}

export const EARNING_TYPES = Object.keys(EARNING_LABEL) as EarningType[]

export interface StaffLookupRow {
  id: string
  full_name: string
  role_name: string
  status: string
}

export interface SalaryStructure {
  id: string
  staff: string
  staff_name: string
  effective_from_bs: string
  basic_salary: string
  grade: string
  allowance: string
  extra: string
  insurance: string
  pf_contribution: string
  pan_no: string
}

export interface AccrualLine {
  id?: string
  earning_type: EarningType
  amount: string
}

export interface SalaryAccrual {
  id: string
  staff: string
  staff_name: string
  date_bs: string
  months: number[]
  academic_year: string
  billing_year: string
  total: string
  remarks: string
  lines?: AccrualLine[]
}

export interface PaymentLine {
  id?: string
  earning_type: EarningType
  amount: string
  due_after?: string | null
  tds_pct?: string | null
  tds_amount?: string | null
}

export interface SalaryPayment {
  id: string
  staff: string
  staff_name: string
  serial: number | null
  legacy_serial: number | null
  date_bs: string
  academic_year: string
  billing_year: string
  payment_month: number
  mode: 'cash' | 'bank' | 'cheque' | 'wallet'
  gross: string
  tds_amount: string
  pf_amount: string | null
  insurance_amount: string | null
  net_paid: string
  tds_percent: string | null
  total_due: string | null
  remarks: string
  lines?: PaymentLine[]
}

export interface HeadBalances {
  staff: string
  salary: string
  grade: string
  allowance: string
  extra: string
  total: string
}

export interface StatementEntry {
  id: string
  kind: 'accrual' | 'payment' | 'deduction'
  date_bs: string
  months: number[]
  serial?: number | null
  debit?: string
  credit?: string
  deduction?: string
  particulars: Array<[string, string]>
}

export function useStaffLookup() {
  return useQuery({
    queryKey: ['payroll', 'staff-lookup'],
    queryFn: () => fetchAllPages<StaffLookupRow>('/api/v1/payroll/staff-lookup/'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useStaffStructures(staffId: string | null) {
  return useQuery({
    queryKey: ['payroll', 'structures', staffId],
    queryFn: () =>
      fetchAllPages<SalaryStructure>('/api/v1/payroll/structures/', { staff: staffId! }),
    enabled: !!staffId,
  })
}

export function useAllStructures() {
  return useQuery({
    queryKey: ['payroll', 'structures', 'all'],
    queryFn: () => fetchAllPages<SalaryStructure>('/api/v1/payroll/structures/'),
  })
}

/** Latest structure per staff — "the current terms" (rows come ordered
 *  staff, -effective_from_bs, so the first row seen per staff wins). */
export function latestStructures(rows: SalaryStructure[] | undefined): Map<string, SalaryStructure> {
  const map = new Map<string, SalaryStructure>()
  for (const row of rows ?? []) {
    if (!map.has(row.staff)) map.set(row.staff, row)
  }
  return map
}

export function useHeadBalances(staffId: string | null, billingYear?: string) {
  return useQuery({
    queryKey: ['payroll', 'balance', staffId, billingYear ?? ''],
    queryFn: async () =>
      (
        await api.get<HeadBalances>('/api/v1/payroll/payments/balance/', {
          params: { staff: staffId, billing_year: billingYear || undefined },
        })
      ).data,
    enabled: !!staffId,
  })
}

export function useStaffStatement(staffId: string | null) {
  return useQuery({
    queryKey: ['payroll', 'statement', staffId],
    queryFn: async () =>
      (
        await api.get<{ staff: string; entries: StatementEntry[] }>(
          '/api/v1/payroll/payments/statement/',
          { params: { staff: staffId } },
        )
      ).data.entries,
    enabled: !!staffId,
  })
}
