import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/** Types mirroring the billing API, plus the lookups its pages lean on. */

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface BillingYear {
  id: string
  name: string
  start_date_bs: string
  end_date_bs: string
  closed: boolean
}

export interface FeeTitle {
  id: string
  name: string
  months: number[]
  kind: 'regular' | 'cash_receipt'
}

export interface FeeSchedule {
  id: string
  class_info: string
  fee_title: string
  title_name: string
  amount: string
}

export interface StandingDiscount {
  id: string
  student: string
  fee_title: string | null // null = transport discount
  flat_amount: string | null
  percentage: string | null
  academic_year: string | null
  remarks: string
}

export type LineType =
  | 'fee'
  | 'transport'
  | 'old_dues'
  | 'opening_balance'
  | 'discount'
  | 'library_fine'
  | 'carry_forward_out'
  | 'other'

export interface PaymentLine {
  id?: string
  line_type: LineType
  fee_title: string | null
  label: string
  amount: string
  discount: string
  due_after?: string | null
  tax_pct?: string | null
  tax_amount?: string | null
}

export interface Payment {
  id: string
  kind: 'regular' | 'cash_receipt'
  serial: number | null
  legacy_serial: number | null
  receipt_no: number | null
  date_bs: string
  student: string | null
  class_info: string | null
  academic_year: string
  billing_year: string
  payment_month: number
  mode: 'cash' | 'bank' | 'cheque' | 'wallet'
  total_paid: string
  total_discount: string | null
  total_due: string | null
  remarks: string
  payer_name: string
  payer_address: string
  lines?: PaymentLine[]
  student_name?: string
  // Education Equality Fee snapshot — a 3% government pass-through collected
  // ON TOP of the receipt; never part of total_paid.
  edu_fee_pct: string | null
  edu_fee_base: string | null
  edu_fee_amount: string | null
}

export interface ChargeLine {
  id: string
  line_type: LineType
  fee_title: string | null
  label: string
  amount: string
}

export interface Charge {
  id: string
  batch: string | null
  student: string
  student_name: string
  date_bs: string
  academic_year: string
  billing_year: string
  total: string
  remarks: string
  lines?: ChargeLine[]
}

export interface ChargeBatch {
  id: string
  date_bs: string
  months: number[]
  academic_year: string
  academic_year_name: string
  billing_year: string
  class_info: string
  class_label: string
  remarks: string
  charge_count: number
}

export interface StudentRow {
  id: string
  full_name: string
  gender: string
  status: string
  roll_no: string
  class_info: string | null
  class_label: string
  contact: string
}

/** Detail serializer shape (no computed full_name/class_label here). */
export interface StudentDetail {
  id: string
  first_name: string
  middle_name: string
  last_name: string
  class_info: string | null
  academic_year: string | null
  roll_no: string
  status: string
  contact: string
  education_level: string | null
}

export function useStudentDetail(studentId: string | null) {
  return useQuery({
    queryKey: ['people', 'student', studentId],
    queryFn: async () =>
      (await api.get<StudentDetail>(`/api/v1/people/students/${studentId}/`)).data,
    enabled: !!studentId,
  })
}

export interface ClassInfo {
  id: string
  label: string
  academic_year: string
}

export interface YearPointer {
  id: string
  key: string
  academic_year: string
  previous_academic_year: string | null
}

export interface AcademicYear {
  id: string
  name: string
  closed: boolean
}

/** Walk DRF pagination so lookup lists (classes, titles) are complete. */
export async function fetchAllPages<T>(url: string, params?: Record<string, string>): Promise<T[]> {
  const all: T[] = []
  let page = 1
  for (;;) {
    const { data } = await api.get<Paginated<T>>(url, {
      params: { ...params, page: String(page) },
    })
    all.push(...data.results)
    if (!data.next) return all
    page += 1
  }
}

// ------------------------------------------------------------- lookups

export function useCalendar() {
  return useQuery({
    queryKey: ['meta', 'calendar'],
    queryFn: async () =>
      (await api.get<{ today_bs: string; today_ad: string }>('/api/v1/meta/calendar/')).data,
    staleTime: 60 * 60 * 1000,
  })
}

export function useBillingYears() {
  return useQuery({
    queryKey: ['billing', 'years'],
    queryFn: () => fetchAllPages<BillingYear>('/api/v1/billing/years/'),
    staleTime: 60 * 60 * 1000,
  })
}

/** Education levels where the school collects the 3% Education Equality Fee
 * (vendor-set). Empty = the levy is off for this school. */
export function useEducationFeeLevels() {
  return useQuery({
    queryKey: ['billing', 'education-fee-levels'],
    queryFn: async () =>
      (
        await api.get<{ enabled: string[]; percent: string }>(
          '/api/v1/billing/education-fee-levels/',
        )
      ).data,
    staleTime: 60 * 60 * 1000,
  })
}

/**
 * The fiscal year receipts are numbered in. Legacy year NAMES are freeform
 * ("FY81/82", "EY 2082/083"), so resolution goes by date range: the open
 * year whose [start, end] BS window contains today, else the open year with
 * the latest start (zero-padded BS dates compare lexically).
 */
export function currentBillingYear(
  years: BillingYear[] | undefined,
  todayBs: string | undefined,
): BillingYear | undefined {
  if (!years?.length) return undefined
  const open = years.filter((y) => !y.closed)
  if (todayBs) {
    const running = open.find((y) => y.start_date_bs <= todayBs && todayBs <= y.end_date_bs)
    if (running) return running
  }
  return [...open].sort((a, b) => b.start_date_bs.localeCompare(a.start_date_bs))[0] ?? years[0]
}

export function useYearPointers() {
  return useQuery({
    queryKey: ['academics', 'year-pointers'],
    queryFn: () => fetchAllPages<YearPointer>('/api/v1/academics/year-pointers/'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useAcademicYears() {
  return useQuery({
    queryKey: ['academics', 'years'],
    queryFn: () => fetchAllPages<AcademicYear>('/api/v1/academics/years/'),
    staleTime: 10 * 60 * 1000,
  })
}

/** Classes of the running academic years (needs the academics permission —
 *  billing-only staff get a graceful empty list plus a hint in the UI). */
export function useClasses(academicYears: string[]) {
  return useQuery({
    queryKey: ['academics', 'classes', academicYears],
    queryFn: async () => {
      const batches = await Promise.all(
        academicYears.map((year) =>
          fetchAllPages<ClassInfo>('/api/v1/academics/classes/', { academic_year: year }),
        ),
      )
      // Dedupe defensively: pointers can share an academic year.
      const unique = new Map(batches.flat().map((c) => [c.id, c]))
      return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label))
    },
    enabled: academicYears.length > 0,
    staleTime: 10 * 60 * 1000,
  })
}

export function useFeeTitles() {
  return useQuery({
    queryKey: ['billing', 'fee-titles'],
    queryFn: () => fetchAllPages<FeeTitle>('/api/v1/billing/fee-titles/'),
  })
}

export function useFeeSchedules(classId: string | null) {
  return useQuery({
    queryKey: ['billing', 'fees', classId],
    queryFn: () =>
      fetchAllPages<FeeSchedule>('/api/v1/billing/fees/', { class_info: classId! }),
    enabled: !!classId,
  })
}

export function useStudentDiscounts(studentId: string | null) {
  return useQuery({
    queryKey: ['billing', 'discounts', studentId],
    queryFn: () =>
      fetchAllPages<StandingDiscount>('/api/v1/billing/discounts/', { student: studentId! }),
    enabled: !!studentId,
  })
}

export function useStudentDues(studentId: string | null) {
  return useQuery({
    queryKey: ['billing', 'dues', studentId],
    queryFn: async () =>
      (
        await api.get<{ student: string; dues: string }>('/api/v1/billing/payments/dues/', {
          params: { student: studentId },
        })
      ).data,
    enabled: !!studentId,
  })
}

/**
 * D-rules: what a standing discount is worth against a fee amount.
 * Percentage WINS when both are set — verified against 18,902 legacy rows
 * where the flat amount is just a cached derivation of the percentage.
 */
export function discountValue(discount: StandingDiscount, feeAmount: string): number {
  const amount = Number(feeAmount) || 0
  const pct = discount.percentage === null ? null : Number(discount.percentage)
  if (pct !== null && !Number.isNaN(pct)) return Math.round(amount * pct) / 100
  return Number(discount.flat_amount) || 0
}
