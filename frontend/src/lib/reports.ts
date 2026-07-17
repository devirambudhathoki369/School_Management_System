import { useQuery } from '@tanstack/react-query'
import { api } from './api'

/**
 * Typed clients for /api/v1/reports/* — the legacy Reports-menu ports.
 * Every hook keys its cache on the full param set so filter changes never
 * serve stale sheets, and `enabled` gates stop half-filled forms from
 * firing requests the server would 400.
 */

export interface ReportSummaryBase {
  count?: number
  [key: string]: unknown
}

interface ReportPayload<Row, Summary = ReportSummaryBase> {
  rows: Row[]
  summary: Summary
  truncated?: boolean
}

function useReport<Row, Summary = ReportSummaryBase>(
  path: string,
  params: Record<string, string | undefined>,
  enabled = true,
) {
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') clean[key] = value
  }
  return useQuery({
    queryKey: ['reports', path, clean],
    queryFn: async () =>
      (await api.get<ReportPayload<Row, Summary>>(`/api/v1/reports/${path}/`, {
        params: clean,
      })).data,
    enabled,
  })
}

/* ------------------------------ finance ------------------------------ */

export interface TransactionRow {
  id: string
  serial: number | null
  date_bs: string
  kind: 'regular' | 'cash_receipt'
  mode: string
  name: string
  class_label: string
  academic_year: string
  total_paid: string
  total_discount: string
  edu_fee: string | null
  cashier: string
  is_active: boolean
  lines: Array<{ label: string; line_type: string; amount: string; discount: string }>
}

export interface TransactionsSummary {
  count: number
  total_paid: string
  total_discount: string
  edu_fee: string
  date_from: string | null
  date_to: string | null
  serial_from: number | null
  serial_to: number | null
}

export function useTransactionsReport(
  params: Record<string, string | undefined>,
  enabled = true,
) {
  return useReport<TransactionRow, TransactionsSummary>('transactions', params, enabled)
}

export interface PostingRow {
  id: string
  date_bs: string
  class_label: string
  academic_year: string
  months: number[]
  remarks: string
  charge_count: number
  total: string
  posted_by: string
  lines: Array<{ label: string; amount: string }>
}

export function usePostingsReport(params: Record<string, string | undefined>) {
  return useReport<PostingRow, { count: number; total: string }>('postings', params)
}

export interface OpeningBalanceRow {
  student_id: string
  student_name: string
  class_label: string
  amount: string
}

export function useOpeningBalancesReport(academicYear: string) {
  return useReport<OpeningBalanceRow, { count: number; total: string; academic_year: string }>(
    'opening-balances',
    { academic_year: academicYear },
    !!academicYear,
  )
}

export interface DuesRow {
  class_info: string
  class_label: string
  debit: string
  credit: string
  balance: string
}

export interface DuesSummary {
  debit: string
  credit: string
  balance: string
  academic_year: string
}

export function useDuesReport(params: Record<string, string | undefined>, enabled = true) {
  return useReport<DuesRow, DuesSummary>('dues', params, enabled)
}

export interface StudentLedgerRow {
  student_id: string
  name: string
  class_label: string
  contact: string
  guardian_name: string
  address: string
  debit: string
  credit: string
  discount: string
  balance: string
}

export interface StudentLedgersSummary {
  count: number
  debit: string
  credit: string
  balance: string
  academic_year: string
}

export function useStudentLedgersReport(
  params: Record<string, string | undefined>,
  enabled = true,
) {
  return useReport<StudentLedgerRow, StudentLedgersSummary>('student-ledgers', params, enabled)
}

export interface IncomePlanPayload {
  classes: Array<{ id: string; label: string; students: number }>
  titles: Record<string, string>
  data: Record<string, Record<string, string>>
}

export function useIncomePlanReport(months: number[], educationLevel: string) {
  const params: Record<string, string> = { months: months.join(',') }
  if (educationLevel) params.education_level = educationLevel
  return useQuery({
    queryKey: ['reports', 'income-plan', params],
    queryFn: async () =>
      (await api.get<IncomePlanPayload>('/api/v1/reports/income-plan/', { params })).data,
    enabled: months.length > 0,
  })
}

export interface StandingDiscountRow {
  id: string
  student_id: string
  name: string
  class_label: string
  fee_title: string
  percentage: string | null
  flat_amount: string | null
  academic_year: string
  remarks: string
  is_active: boolean
}

export function useStandingDiscountsReport(params: Record<string, string | undefined>) {
  return useReport<StandingDiscountRow>('standing-discounts', params)
}

export interface PaymentDiscountRow {
  id: string
  serial: number | null
  date_bs: string
  name: string
  class_label: string
  total_discount: string
  cashier: string
  lines: Array<{ label: string; discount: string }>
}

export function usePaymentDiscountsReport(
  params: Record<string, string | undefined>,
  enabled = true,
) {
  return useReport<PaymentDiscountRow, { count: number; total_discount: string }>(
    'payment-discounts',
    params,
    enabled,
  )
}

export interface IntegrityPayload {
  payments: Array<{
    id: string
    serial: number | null
    date_bs: string
    name: string
    class_label: string
    payment_year: string
    class_year: string
    total_paid: string
  }>
  charges: Array<{
    id: string
    date_bs: string
    name: string
    charge_year: string
    batch_year: string
    total: string
  }>
  summary: { payment_mismatches: number; charge_mismatches: number }
}

export function useIntegrityReport() {
  return useQuery({
    queryKey: ['reports', 'integrity'],
    queryFn: async () =>
      (await api.get<IntegrityPayload>('/api/v1/reports/integrity/')).data,
  })
}

/* ------------------------------ campus ------------------------------ */

export interface AdmissionRow {
  id: string
  name: string
  gender: string
  class_label: string
  roll_no: string
  regd_no: string
  contact: string
  address: string
  birth_date_bs: string
  guardian_name: string
  guardian_contact: string
  previous_school: string
  admission_year: string
  status: string
  enrolled_at: string
}

export interface AdmissionsSummary {
  count: number
  male: number
  female: number
  academic_year: string
}

export function useAdmissionsReport(params: Record<string, string | undefined>) {
  return useReport<AdmissionRow, AdmissionsSummary>('admissions', params)
}

export interface StaffDetailRow {
  id: string
  name: string
  role: string
  gender: string
  primary_contact: string
  secondary_contact: string
  email: string
  address: string
  qualification: string
  joined_date_bs: string
  birth_date_bs: string
  primary_subject: string
  secondary_subject: string
  status: string
  has_login: boolean
}

export function useStaffDetailsReport(status: string) {
  return useReport<StaffDetailRow>('staff-details', { status })
}

export interface TransportRow {
  id: string
  name: string
  class_label: string
  station: string
  fee: string | null
  start_date_bs: string
  contact: string
  guardian_name: string
  is_active: boolean
}

export function useTransportReport(params: Record<string, string | undefined>) {
  return useReport<TransportRow>('transport-history', params)
}

export interface HomeworkRow {
  id: string
  teacher: string
  class_label: string
  subject: string
  title: string
  description: string
  due_date_bs: string
  attachments: number
  is_active: boolean
}

export function useHomeworkReport(dateBs: string) {
  return useReport<HomeworkRow, { count: number; date_bs: string }>(
    'homework-given',
    { date_bs: dateBs },
    !!dateBs,
  )
}

export interface AttendanceClassRow {
  student_id: string
  name: string
  roll_no: string
  marked: number
  present: number
  absent: number
  rate: number | null
}

export interface AttendanceSchoolRow {
  class_info: string
  class_label: string
  days_marked: number
  marked: number
  present: number
  absent: number
}

export function useAttendanceSummaryReport(
  params: Record<string, string | undefined>,
  enabled = true,
) {
  return useReport<AttendanceClassRow | AttendanceSchoolRow, ReportSummaryBase>(
    'attendance-summary',
    params,
    enabled,
  )
}

export interface ClassStatRow {
  class_info: string
  class_label: string
  male: number
  female: number
  other: number
  total: number
}

export function useClassStatisticsReport() {
  return useReport<ClassStatRow>('class-statistics', {})
}

export interface BirthdayRow {
  id: string
  name: string
  birth_date_bs: string
  is_today: boolean
  class_label?: string
  role?: string
}

export function useBirthdaysReport(kind: 'student' | 'staff', enabled = true) {
  return useReport<BirthdayRow, { count: number; date_bs: string }>(
    `${kind}-birthdays`,
    {},
    enabled,
  )
}
