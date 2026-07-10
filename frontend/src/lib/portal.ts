import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './api'

/** Types + hooks for the guardian portal (read-only family window). */

export interface AttendanceToday {
  present: boolean
  checked_in_at: string | null
  checked_out_at: string | null
}

export interface PortalChild {
  id: string
  full_name: string
  first_name: string
  gender: string
  status: string
  roll_no: string
  class_label: string
  academic_year: string
  academic_year_name: string
  relation: string
  is_primary_contact: boolean
  dues: string
  attendance_today: AttendanceToday | null
}

export interface PortalChildren {
  guardian: { name: string; contact: string; email: string; address: string }
  today_bs: string
  children: PortalChild[]
}

export interface AttendanceDay {
  date_bs: string
  present: boolean
  reason: string
  checked_in_at: string | null
  checked_out_at: string | null
}

export interface AttendanceMonth {
  month_bs: string
  days: AttendanceDay[]
  summary: { marked: number; present: number; absent: number }
}

export interface ResultSubject {
  subject: string
  full_marks: string
  pass_marks: string
  theory: string | null
  practical: string | null
  total: string
  passed: boolean
  absent: boolean
}

export interface ResultExam {
  exam_id: string
  exam_name: string
  academic_year_name: string
  published_date_bs: string
  position_in_section: number | null
  position_in_class: number | null
  subjects: ResultSubject[]
  total: string
  full_marks: string
  percentage: string | null
  all_passed: boolean
}

export interface FeeLine {
  label: string
  amount: string
  discount?: string
}

export interface FeeCharge {
  id: string
  date_bs: string
  total: string
  remarks: string
  months: number[]
  lines: FeeLine[]
}

export interface FeePayment {
  id: string
  kind: string
  serial: number | null
  date_bs: string
  mode: string
  total_paid: string
  total_discount: string
  remarks: string
  lines: FeeLine[]
}

export interface FeeStatement {
  years: Array<{ id: string; name: string }>
  year: string
  dues_total: string
  year_charged: string
  year_paid: string
  charges: FeeCharge[]
  payments: FeePayment[]
}

export interface HomeworkItem {
  id: string
  title: string
  description: string
  due_date_bs: string
  subject: string
  teacher: string
  attachments: Array<{ name: string; url: string }>
}

export interface PortalNotice {
  id: string
  title: string
  description: string
  date_bs: string
  image: string | null
}

export interface PortalEvent {
  id: string
  event_type: string
  start_date_bs: string
  end_date_bs: string
  description: string
  color: string
}

export function useChildren() {
  return useQuery({
    queryKey: ['portal', 'children'],
    queryFn: async () => (await api.get<PortalChildren>('/api/v1/portal/children/')).data,
  })
}

export function useChildAttendance(childId: string, monthBs: string) {
  return useQuery({
    queryKey: ['portal', 'attendance', childId, monthBs],
    queryFn: async () =>
      (
        await api.get<AttendanceMonth>(`/api/v1/portal/children/${childId}/attendance/`, {
          params: monthBs ? { month_bs: monthBs } : {},
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

export function useChildResults(childId: string) {
  return useQuery({
    queryKey: ['portal', 'results', childId],
    queryFn: async () =>
      (await api.get<{ exams: ResultExam[] }>(`/api/v1/portal/children/${childId}/results/`))
        .data,
  })
}

export function useChildFees(childId: string, year: string) {
  return useQuery({
    queryKey: ['portal', 'fees', childId, year],
    queryFn: async () =>
      (
        await api.get<FeeStatement>(`/api/v1/portal/children/${childId}/fees/`, {
          params: year ? { year } : {},
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

export function useChildHomework(childId: string) {
  return useQuery({
    queryKey: ['portal', 'homework', childId],
    queryFn: async () =>
      (
        await api.get<{ today_bs: string; homework: HomeworkItem[] }>(
          `/api/v1/portal/children/${childId}/homework/`,
        )
      ).data,
  })
}

export function useNotices() {
  return useQuery({
    queryKey: ['portal', 'notices'],
    queryFn: async () =>
      (await api.get<{ notices: PortalNotice[] }>('/api/v1/portal/notices/')).data,
  })
}

export function usePortalCalendar(monthBs: string) {
  return useQuery({
    queryKey: ['portal', 'calendar', monthBs],
    queryFn: async () =>
      (
        await api.get<{ month_bs: string; events: PortalEvent[] }>('/api/v1/portal/calendar/', {
          params: monthBs ? { month_bs: monthBs } : {},
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

/** '2082-03' -> '2082-04'; step may be negative. */
export function shiftMonthBs(monthBs: string, step: number): string {
  const [y, m] = monthBs.split('-').map(Number)
  const total = y * 12 + (m - 1) + step
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}
