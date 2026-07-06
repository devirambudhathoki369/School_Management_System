import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { fetchAllPages, type Paginated } from './billing'

/** Types + lookups for the attendance workspace. */

export interface AttendanceRecord {
  id: string
  student: string
  student_name: string
  present: boolean
  checked_in_at: string | null
  checked_out_at: string | null
  reason: string
}

export interface AttendanceSession {
  id: string
  date_bs: string
  class_info: string
  teacher: string | null
  records: AttendanceRecord[]
}

export interface StaffAttendanceRecord {
  id: string
  date_bs: string
  staff: string
  staff_name: string
  present: boolean
  checked_in_at: string | null
  checked_out_at: string | null
  reason: string
}

export interface RosterStudent {
  id: string
  full_name: string
  roll_no: string
}

export interface RosterStaff {
  id: string
  full_name: string
}

export function useClassRoster(classId: string | null) {
  return useQuery({
    queryKey: ['attendance', 'roster', classId],
    queryFn: async () =>
      (
        await api.get<RosterStudent[]>('/api/v1/attendance/roster/', {
          params: { class_info: classId },
        })
      ).data,
    enabled: !!classId,
  })
}

export function useStaffRoster() {
  return useQuery({
    queryKey: ['attendance', 'staff-roster'],
    queryFn: async () => (await api.get<RosterStaff[]>('/api/v1/attendance/roster/')).data,
    staleTime: 10 * 60 * 1000,
  })
}

/** The (class, day) session if one exists — sessions are unique per pair. */
export function useSession(classId: string | null, dateBs: string | null) {
  return useQuery({
    queryKey: ['attendance', 'session', classId, dateBs],
    queryFn: async () => {
      const { data } = await api.get<Paginated<AttendanceSession>>(
        '/api/v1/attendance/sessions/',
        { params: { class_info: classId, date_bs: dateBs } },
      )
      const header = data.results[0]
      if (!header) return null
      // list rows skip the records prefetch; fetch the full session
      return (
        await api.get<AttendanceSession>(`/api/v1/attendance/sessions/${header.id}/`)
      ).data
    },
    enabled: !!classId && !!dateBs,
  })
}

export function useDaySessions(dateBs: string | null) {
  return useQuery({
    queryKey: ['attendance', 'day', dateBs],
    queryFn: () =>
      fetchAllPages<AttendanceSession>('/api/v1/attendance/sessions/', { date_bs: dateBs! }),
    enabled: !!dateBs,
  })
}

export function useStaffDay(dateBs: string | null) {
  return useQuery({
    queryKey: ['attendance', 'staff-day', dateBs],
    queryFn: () =>
      fetchAllPages<StaffAttendanceRecord>('/api/v1/attendance/staff/', { date_bs: dateBs! }),
    enabled: !!dateBs,
  })
}
