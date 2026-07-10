import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from './api'
import { fetchAllPages, type Paginated } from './billing'

/** Types + lookups for the RFID devices workspace (ZKTeco push protocol). */

export interface Device {
  id: string
  serial_number: string
  alias: string
  ip_address: string
  firmware: string
  push_version: string
  device_type: string
  timezone_min: number
  real_time: boolean
  state: string
  last_seen: string | null
  user_count: number
  fp_count: number
  face_count: number
  trans_count: number
}

export interface DeviceUser {
  id: string
  device: string
  device_alias: string
  pin: string
  card: string
  student: string | null
  staff: string | null
  person_name: string
  verify: string
}

export interface PunchLog {
  id: string
  user: string
  pin: string
  punch_time: string
  status: string
  verify: string
  received_at: string
}

export function useDevices() {
  return useQuery({
    queryKey: ['devices', 'registry'],
    queryFn: () => fetchAllPages<Device>('/api/v1/devices/devices/'),
  })
}

export function useDeviceUsers(page: number, device: string) {
  return useQuery({
    queryKey: ['devices', 'users', page, device],
    queryFn: async () =>
      (
        await api.get<Paginated<DeviceUser>>('/api/v1/devices/users/', {
          params: { page, ...(device ? { device } : {}) },
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}

export function usePunchLogs(page: number, device: string) {
  return useQuery({
    queryKey: ['devices', 'punches', page, device],
    queryFn: async () =>
      (
        await api.get<Paginated<PunchLog>>('/api/v1/devices/logs/', {
          params: { page, ...(device ? { device } : {}) },
        })
      ).data,
    placeholderData: keepPreviousData,
  })
}
