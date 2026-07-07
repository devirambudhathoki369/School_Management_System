import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './api'
import { fetchAllPages, type Paginated } from './billing'

/**
 * Types + lookups for the campus modules: communication, homework, library,
 * transport and inventory. One lib because each module's surface is small.
 */

// ------------------------------------------------------------ communication

export interface Notice {
  id: string
  title: string
  description: string
  date_bs: string
  image: string | null
}

export interface CalendarEventRow {
  id: string
  start_date_bs: string
  end_date_bs: string
  event_type: 'holiday' | 'exam' | 'result' | 'event' | 'vacation'
  color: string
  description: string
}

export const EVENT_TYPES = [
  ['holiday', 'Public holiday'],
  ['exam', 'Exam'],
  ['result', 'Result'],
  ['event', 'Event day'],
  ['vacation', 'Vacation'],
] as const

export interface MessageTemplateRow {
  id: string
  kind: 'dues' | 'payment' | 'result' | 'attendance' | 'birthday'
  body: string
}

export const TEMPLATE_KINDS = [
  ['dues', 'Dues reminder'],
  ['payment', 'Payment received'],
  ['result', 'Result published'],
  ['attendance', 'Attendance check-in'],
  ['birthday', 'Birthday'],
] as const

export interface DeliveryRow {
  id: string
  recipient: string | null
  title: string
  body: string
  status: 'queued' | 'sent' | 'failed' | 'stale'
  sent_at: string
}

export function useNotices(page: number) {
  return useQuery({
    queryKey: ['communication', 'notices', page],
    queryFn: async () =>
      (
        await api.get<Paginated<Notice>>('/api/v1/communication/notices/', {
          params: { page },
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

export function useCalendarEvents() {
  return useQuery({
    queryKey: ['communication', 'calendar'],
    queryFn: () => fetchAllPages<CalendarEventRow>('/api/v1/communication/calendar/'),
  })
}

export function useTemplates() {
  return useQuery({
    queryKey: ['communication', 'templates'],
    queryFn: () => fetchAllPages<MessageTemplateRow>('/api/v1/communication/templates/'),
  })
}

export function useDeliveries(status: string, page: number) {
  return useQuery({
    queryKey: ['communication', 'deliveries', status, page],
    queryFn: async () =>
      (
        await api.get<Paginated<DeliveryRow>>('/api/v1/communication/delivery-log/', {
          params: { status: status || undefined, page },
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

// ----------------------------------------------------------------- homework

export interface HomeworkAttachment {
  id: string
  file: string
}

export interface HomeworkRow {
  id: string
  title: string
  description: string
  due_date_bs: string
  class_info: string
  subject: string
  subject_name: string
  staff: string
  staff_name: string
  attachments?: HomeworkAttachment[]
}

export interface HomeworkStaffRow {
  id: string
  full_name: string
  role_name: string
  status: string
}

export function useHomeworkList(classId: string | null) {
  return useQuery({
    queryKey: ['homework', 'list', classId],
    queryFn: () =>
      fetchAllPages<HomeworkRow>('/api/v1/homework/assignments/', {
        class_info: classId!,
      }),
    enabled: !!classId,
  })
}

export function useHomeworkDetail(id: string | null) {
  return useQuery({
    queryKey: ['homework', 'detail', id],
    queryFn: async () =>
      (await api.get<HomeworkRow>(`/api/v1/homework/assignments/${id}/`)).data,
    enabled: !!id,
  })
}

export function useHomeworkStaff() {
  return useQuery({
    queryKey: ['homework', 'staff-lookup'],
    queryFn: () => fetchAllPages<HomeworkStaffRow>('/api/v1/homework/staff-lookup/'),
    staleTime: 10 * 60 * 1000,
  })
}

// ------------------------------------------------------------------ library

export interface LibraryRow {
  id: string
  name: string
  address: string
  contacts: string
  fine_per_day: string
  fine_on_damage: string
}

export interface BookRow {
  id: string
  library: string
  title: string
  personal_author: string
  isbn_no: string
  call_no: string
  edition: string
  place_and_publisher: string
  published_year: string
  price: string
  quantity: number
  broad_subject: string
  entry_date_bs: string
  class_info: string | null
}

export interface BookCopyRow {
  id: string
  book: string
  book_title: string
  accession_no: number
  entry_date_bs: string
  is_lost: boolean
  is_damaged: boolean
  remarks: string
}

export interface LoanRow {
  id: string
  copy: string
  book_title: string
  copy_accession: number
  student: string | null
  staff: string | null
  borrower_name: string
  issued_date_bs: string
  due_date_bs: string
  returned_date_bs: string
  fine_amount: string
  remarks: string
}

export function useLibraries() {
  return useQuery({
    queryKey: ['library', 'libraries'],
    queryFn: () => fetchAllPages<LibraryRow>('/api/v1/library/libraries/'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useBooks(libraryId: string | null, search: string, page: number) {
  return useQuery({
    queryKey: ['library', 'books', libraryId, search, page],
    queryFn: async () =>
      (
        await api.get<Paginated<BookRow>>('/api/v1/library/books/', {
          params: { library: libraryId || undefined, search: search || undefined, page },
        })
      ).data,
    enabled: !!libraryId,
    placeholderData: keepPreviousData,
  })
}

export function useBookCopies(bookId: string | null) {
  return useQuery({
    queryKey: ['library', 'copies', bookId],
    queryFn: () => fetchAllPages<BookCopyRow>('/api/v1/library/copies/', { book: bookId! }),
    enabled: !!bookId,
  })
}

export function useOpenLoans() {
  return useQuery({
    queryKey: ['library', 'loans', 'open'],
    queryFn: () => fetchAllPages<LoanRow>('/api/v1/library/loans/', { open: 'true' }),
  })
}

// ---------------------------------------------------------------- transport

export interface StationRow {
  id: string
  name: string
  fee: string
  latitude: string | null
  longitude: string | null
  rider_count: number
}

export interface RiderRow {
  id: string
  student: string
  student_name: string
  bus_station: string | null
  station_name: string | null
  start_date_bs: string
  remarks: string
}

export function useStations() {
  return useQuery({
    queryKey: ['transport', 'stations'],
    queryFn: () => fetchAllPages<StationRow>('/api/v1/transport/stations/'),
  })
}

export function useRiders(stationId: string | null, page: number) {
  return useQuery({
    queryKey: ['transport', 'riders', stationId, page],
    queryFn: async () =>
      (
        await api.get<Paginated<RiderRow>>('/api/v1/transport/riders/', {
          params: { bus_station: stationId || undefined, page },
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

// ---------------------------------------------------------------- inventory

export interface InventoryCategory {
  id: string
  name: string
}

export interface InventoryItem {
  id: string
  name: string
  category: string | null
  category_name: string | null
  unit: string
  reorder_level: string | null
  stock: string | null
}

export interface StockTxn {
  id: string
  item: string
  item_name: string
  txn_type: 'purchase' | 'issue' | 'adjustment' | 'wastage'
  quantity: string
  unit_price: string | null
  total: string | null
  date_bs: string
  academic_year: string
  billing_year: string | null
  supplier: string
  party_or_purpose: string
  remarks: string
}

export const TXN_TYPES = [
  ['purchase', 'Purchase (in)'],
  ['issue', 'Issue (out)'],
  ['wastage', 'Wastage (out)'],
  ['adjustment', 'Adjustment (signed)'],
] as const

export function useInventoryCategories() {
  return useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn: () => fetchAllPages<InventoryCategory>('/api/v1/inventory/categories/'),
    staleTime: 10 * 60 * 1000,
  })
}

export function useInventoryItems() {
  return useQuery({
    queryKey: ['inventory', 'items'],
    queryFn: () => fetchAllPages<InventoryItem>('/api/v1/inventory/items/'),
  })
}

export function useStockTxns(itemId: string | null, page: number) {
  return useQuery({
    queryKey: ['inventory', 'txns', itemId, page],
    queryFn: async () =>
      (
        await api.get<Paginated<StockTxn>>('/api/v1/inventory/transactions/', {
          params: { item: itemId || undefined, page },
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}
