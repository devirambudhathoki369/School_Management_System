import { useQuery } from '@tanstack/react-query'
import { fetchAllPages } from './billing'

/** Types + lookups for the academics workspace (years, classes, subjects). */

export interface AcademicYearFull {
  id: string
  name: string
  start_date_bs: string
  end_date_bs: string
  closed: boolean
  remarks: string
}

export interface YearPointerFull {
  id: string
  key: string
  academic_year: string
  previous_academic_year: string | null
}

export interface ClassInfoFull {
  id: string
  education_level: string
  grade: string
  faculty: string
  course: string | null
  section: string | null
  year: number | null
  semester: number | null
  display_name: string
  academic_year: string | null
  label: string
  students_count: number
}

export interface SubjectFull {
  id: string
  class_info: string
  name: string
  code: string
  type: 'compulsory' | 'optional'
  credit_hours: string
  order: number
  name_practical: string
  code_practical: string
  credit_hours_practical: string | null
  is_protected: boolean
}

export interface CourseRow {
  id: string
  name: string
  education_level: string
  // Program length — either year-wise or semester-wise, never both.
  total_years: number | null
  total_semesters: number | null
}

export interface BatchRow {
  id: string
  course: string | null
  course_name: string
  education_level: string
  year: string
  start_academic_year: string | null
  start_academic_year_name: string
  current_semester: number | null
  current_year: number | null
  graduated: boolean
}

export interface SectionRow {
  id: string
  name: string
}

/** Choice vocabularies mirroring the backend TextChoices. */
export const EDUCATION_LEVELS = [
  ['montessori', 'Montessori'],
  ['school', 'School'],
  ['school_govt', 'School (GOVT.)'],
  ['pre_diploma', 'Pre-diploma'],
  ['diploma', 'Diploma'],
  ['highschool', 'High school'],
  ['bachelor', 'Bachelor'],
  ['master', 'Master'],
] as const

export const GRADES = [
  ['play_group', 'Play group'],
  ['nursery', 'Nursery'],
  ['lkg', 'LKG'],
  ['ukg', 'UKG'],
  ['one', 'One'],
  ['two', 'Two'],
  ['three', 'Three'],
  ['four', 'Four'],
  ['five', 'Five'],
  ['six', 'Six'],
  ['seven', 'Seven'],
  ['eight', 'Eight'],
  ['nine', 'Nine'],
  ['ten', 'Ten'],
  ['eleven', 'Eleven'],
  ['twelve', 'Twelve'],
] as const

export const FACULTIES = [
  ['science', 'Science'],
  ['management', 'Management'],
  ['education', 'Education'],
  ['arts', 'Arts'],
  ['humanities', 'Humanities'],
  ['law', 'Law'],
] as const

export function choiceLabel(
  choices: readonly (readonly [string, string])[],
  value: string | null | undefined,
): string {
  if (!value) return ''
  return choices.find(([v]) => v === value)?.[1] ?? value
}

export function useAcademicYearsFull() {
  return useQuery({
    queryKey: ['academics', 'years-full'],
    queryFn: () => fetchAllPages<AcademicYearFull>('/api/v1/academics/years/'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useYearPointersFull() {
  return useQuery({
    queryKey: ['academics', 'year-pointers'],
    queryFn: () => fetchAllPages<YearPointerFull>('/api/v1/academics/year-pointers/'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useClassesOfYear(yearId: string | null) {
  return useQuery({
    queryKey: ['academics', 'classes-of-year', yearId],
    queryFn: () =>
      fetchAllPages<ClassInfoFull>('/api/v1/academics/classes/', {
        academic_year: yearId!,
      }),
    enabled: !!yearId,
  })
}

export function useSubjectsOfClass(classId: string | null) {
  return useQuery({
    queryKey: ['academics', 'subjects', classId],
    queryFn: () =>
      fetchAllPages<SubjectFull>('/api/v1/academics/subjects/', { class_info: classId! }),
    enabled: !!classId,
  })
}

export function useCourses() {
  return useQuery({
    queryKey: ['academics', 'courses'],
    queryFn: () => fetchAllPages<CourseRow>('/api/v1/academics/courses/'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useSections() {
  return useQuery({
    queryKey: ['academics', 'sections'],
    queryFn: () => fetchAllPages<SectionRow>('/api/v1/academics/sections/'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useBatches() {
  return useQuery({
    queryKey: ['academics', 'batches'],
    queryFn: () => fetchAllPages<BatchRow>('/api/v1/academics/batches/'),
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * The most sensible default year for pickers: the year a running pointer
 * targets (A2 — "current" is only ever pointer-resolved), else the latest
 * open year, else the latest year.
 */
export function defaultYearId(
  years: AcademicYearFull[] | undefined,
  pointers: YearPointerFull[] | undefined,
): string {
  if (!years?.length) return ''
  const pointed = pointers?.find((p) => years.some((y) => y.id === p.academic_year))
  if (pointed) return pointed.academic_year
  const open = years.filter((y) => !y.closed)
  const pool = open.length ? open : years
  return [...pool].sort((a, b) => b.start_date_bs.localeCompare(a.start_date_bs))[0].id
}
