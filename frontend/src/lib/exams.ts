import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { fetchAllPages } from './billing'

/** Types + lookups for the examinations workspace. */

export interface Exam {
  id: string
  name: string
  academic_year: string
  inclusion_weight: string | null
  include_attendance: boolean
}

export interface ScheduleEntry {
  id: string
  exam: string
  class_info: string
  subject: string
  subject_name: string
  exam_date_bs: string
  start_time: string | null
  end_time: string | null
}

export interface GradeBand {
  id?: string
  min_score: string
  max_score: string
  remarks: string
}

export interface GradingScheme {
  id: string
  type: 'number' | 'grading' | 'division'
  bands: GradeBand[]
}

export const SCHEME_LABEL: Record<GradingScheme['type'], string> = {
  number: 'Number system',
  grading: 'Grading system',
  division: 'Division',
}

export interface ResultSheet {
  id: string
  exam: string
  class_info: string
  subject: string
  subject_name: string
  full_marks: string
  pass_marks: string
  full_marks_theory: string | null
  pass_marks_theory: string | null
  full_marks_practical: string | null
  pass_marks_practical: string | null
  attendance_days: number | null
  published_date_bs: string | null
  is_published: boolean
}

export interface MarkRow {
  id?: string
  student: string
  student_name?: string
  roll_no?: string
  theory: string | null
  practical: string | null
  total: string | null
  inclusion: string | null
  attendance_days: number | null
  passed: boolean | null
  absent: boolean
  position_in_section: number | null
  position_in_class: number | null
}

export interface RosterRow {
  id: string
  full_name: string
  roll_no: string
}

export interface SubjectRow {
  id: string
  class_info: string
  name: string
  code: string
  credit_hours: string
}

export function useExams() {
  return useQuery({
    queryKey: ['exams', 'list'],
    queryFn: () => fetchAllPages<Exam>('/api/v1/examinations/exams/'),
  })
}

export function useSheets(examId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ['exams', 'sheets', examId, classId],
    queryFn: () =>
      fetchAllPages<ResultSheet>('/api/v1/examinations/sheets/', {
        exam: examId!,
        class_info: classId!,
      }),
    enabled: !!examId && !!classId,
  })
}

export function useSheet(sheetId: string | null) {
  return useQuery({
    queryKey: ['exams', 'sheet', sheetId],
    queryFn: async () =>
      (await api.get<ResultSheet>(`/api/v1/examinations/sheets/${sheetId}/`)).data,
    enabled: !!sheetId,
  })
}

export function useSheetMarks(sheetId: string | null) {
  return useQuery({
    queryKey: ['exams', 'marks', sheetId],
    queryFn: async () =>
      (await api.get<MarkRow[]>(`/api/v1/examinations/sheets/${sheetId}/marks/`)).data,
    enabled: !!sheetId,
  })
}

export function useSheetRoster(sheetId: string | null) {
  return useQuery({
    queryKey: ['exams', 'roster', sheetId],
    queryFn: async () =>
      (await api.get<RosterRow[]>(`/api/v1/examinations/sheets/${sheetId}/roster/`)).data,
    enabled: !!sheetId,
  })
}

export function useClassSubjects(classId: string | null) {
  return useQuery({
    queryKey: ['academics', 'subjects', classId],
    queryFn: () =>
      fetchAllPages<SubjectRow>('/api/v1/academics/subjects/', { class_info: classId! }),
    enabled: !!classId,
  })
}

export function useSchedule(examId: string | null) {
  return useQuery({
    queryKey: ['exams', 'schedule', examId],
    queryFn: () =>
      fetchAllPages<ScheduleEntry>('/api/v1/examinations/schedule/', { exam: examId! }),
    enabled: !!examId,
  })
}

export function useGradingSchemes() {
  return useQuery({
    queryKey: ['exams', 'grading-schemes'],
    queryFn: () => fetchAllPages<GradingScheme>('/api/v1/examinations/grading-schemes/'),
  })
}

export interface ClassResultMark {
  theory: string | null
  practical: string | null
  total: string
  passed: boolean
  absent: boolean
  letter: string
  grade_point: string
}

export interface ClassResultStudent {
  id: string
  name: string
  roll_no: string
  marks: Record<string, ClassResultMark>
  total: string
  full_marks: string
  percentage: string
  gpa: string | null
  gpa_letter: string
  all_passed: boolean
  position_in_section: number | null
  position_in_class: number | null
}

export interface ClassResult {
  exam: { id: string; name: string; academic_year_name: string }
  class_label: string
  published: boolean
  subjects: Array<{
    id: string
    name: string
    full_marks: string
    pass_marks: string
    published: boolean
  }>
  students: ClassResultStudent[]
}

export function useClassResult(examId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ['exams', 'class-result', examId, classId],
    queryFn: async () =>
      (
        await api.get<ClassResult>(
          `/api/v1/examinations/exams/${examId}/class-result/`,
          { params: { class_info: classId } },
        )
      ).data,
    enabled: !!examId && !!classId,
  })
}
