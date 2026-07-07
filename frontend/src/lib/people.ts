import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './api'
import { fetchAllPages, type Paginated, type StudentRow } from './billing'

/** Types + lookups for the people workspace (students, guardians, staff). */

export interface GuardianPerson {
  id: string
  name: string
  contact: string
  email: string
  address: string
  occupation: string
}

export interface GuardianLink {
  id: string
  guardian: GuardianPerson
  relation: 'father' | 'mother' | 'guardian' | 'other'
  is_primary_contact: boolean
}

export interface StudentFull {
  id: string
  first_name: string
  middle_name: string
  last_name: string
  birth_date_bs: string
  gender: string
  email: string
  contact: string
  address: string
  status: 'running' | 'passed_out' | 'dropped_out'
  class_info: string
  academic_year: string
  class_label: string
  academic_year_name: string
  roll_no: string
  symbol_no: string
  regd_no: string
  emis: string
  rfid_card: string
  previous_school: string
  remarks: string
  ethnicity: string
  blood_group: string
  guardians: GuardianLink[]
}

export interface StaffMember {
  id: string
  full_name: string
  first_name: string
  middle_name: string
  last_name: string
  role: string
  role_name: string
  status: 'employed' | 'departed' | 'retired' | 'on_leave'
  gender: string
  birth_date_bs: string
  email: string
  primary_contact: string
  secondary_contact: string
  address: string
  qualification: string
  joined_date_bs: string
  rfid_card: string
  primary_subject: string | null
  secondary_subject: string | null
  permissions: string[]
}

export interface StaffRoleRow {
  id: string
  name: string
}

export interface PermissionModule {
  code: string
  label: string
  permissions: string[]
}

export const RELATIONS = [
  ['father', 'Father'],
  ['mother', 'Mother'],
  ['guardian', 'Guardian'],
  ['other', 'Other'],
] as const

export const GENDERS = [
  ['male', 'Male'],
  ['female', 'Female'],
  ['others', 'Others'],
] as const

export const STUDENT_STATUSES = [
  ['running', 'Running'],
  ['passed_out', 'Passed out'],
  ['dropped_out', 'Dropped out'],
] as const

export const STAFF_STATUSES = [
  ['employed', 'Employed'],
  ['departed', 'Departed'],
  ['retired', 'Retired'],
  ['on_leave', 'On leave'],
] as const

export function useStudentsPage(params: {
  search: string
  status: string
  classInfo: string
  page: number
}) {
  return useQuery({
    queryKey: ['people', 'students', params],
    queryFn: async () =>
      (
        await api.get<Paginated<StudentRow>>('/api/v1/people/students/', {
          params: {
            search: params.search || undefined,
            status: params.status || undefined,
            class_info: params.classInfo || undefined,
            page: params.page,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

export function useStudentFull(studentId: string | null) {
  return useQuery({
    queryKey: ['people', 'student-full', studentId],
    queryFn: async () =>
      (await api.get<StudentFull>(`/api/v1/people/students/${studentId}/`)).data,
    enabled: !!studentId,
  })
}

/** Every running student of one class — feeds the promote picker. */
export function useClassStudents(classId: string | null) {
  return useQuery({
    queryKey: ['people', 'class-students', classId],
    queryFn: () =>
      fetchAllPages<StudentRow>('/api/v1/people/students/', {
        class_info: classId!,
        status: 'running',
      }),
    enabled: !!classId,
  })
}

export function useStaffList(params: { search: string; status: string; page: number }) {
  return useQuery({
    queryKey: ['people', 'staff', params],
    queryFn: async () =>
      (
        await api.get<Paginated<StaffMember>>('/api/v1/people/staff/', {
          params: {
            search: params.search || undefined,
            status: params.status || undefined,
            page: params.page,
          },
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

export function useStaffRoles() {
  return useQuery({
    queryKey: ['people', 'staff-roles'],
    queryFn: () => fetchAllPages<StaffRoleRow>('/api/v1/people/staff-roles/'),
    staleTime: 60 * 60 * 1000,
  })
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: ['auth', 'permission-catalog'],
    queryFn: async () =>
      (
        await api.get<{ modules: PermissionModule[] }>('/api/v1/auth/permission-catalog/')
      ).data.modules,
    staleTime: 60 * 60 * 1000,
  })
}

export function useGuardianSearch(search: string) {
  return useQuery({
    queryKey: ['people', 'guardian-search', search],
    queryFn: async () =>
      (
        await api.get<Paginated<GuardianPerson>>('/api/v1/people/guardians/', {
          params: { search },
        })
      ).data.results,
    enabled: search.trim().length >= 2,
    staleTime: 30_000,
  })
}
