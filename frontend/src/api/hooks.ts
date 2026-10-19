import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  AppConfig,
  Appointment,
  AvailabilityResponse,
  Dashboard,
  Paginated,
  Service,
  StaffMember,
} from './types'

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/config/'), staleTime: Infinity })
}

export function useServices() {
  return useQuery({ queryKey: ['services'], queryFn: () => api<Service[]>('/services/'), staleTime: 5 * 60_000 })
}

export function useStaff(serviceId?: number) {
  return useQuery({
    queryKey: ['staff', serviceId ?? 'all'],
    queryFn: () => api<StaffMember[]>(`/staff/${serviceId ? `?service=${serviceId}` : ''}`),
    staleTime: 5 * 60_000,
  })
}

export function useAvailability(params: { service?: number; staff?: number; from: string; to: string }) {
  const query = new URLSearchParams({ service: String(params.service), from: params.from, to: params.to })
  if (params.staff) query.set('staff', String(params.staff))
  return useQuery({
    queryKey: ['availability', params],
    queryFn: () => api<AvailabilityResponse>(`/availability/?${query}`),
    enabled: Boolean(params.service),
    refetchInterval: 60_000,
  })
}

export type AppointmentFilters = {
  scope?: 'upcoming' | 'past'
  date?: string
  status?: string
  staff?: number
  page?: number
}

export function useAppointments(filters: AppointmentFilters = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== '') query.set(key, String(value))
  return useQuery({
    queryKey: ['appointments', filters],
    queryFn: () => api<Paginated<Appointment>>(`/appointments/?${query}`),
  })
}

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard/') })
}

export function useCreateAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { service_id: number; staff_id: number; start: string; notes?: string }) =>
      api<Appointment>('/appointments/', { method: 'POST', json: body }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['availability'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export type AppointmentAction = 'cancel' | 'confirm' | 'complete' | 'no-show'

export function useAppointmentAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: AppointmentAction }) =>
      api<Appointment>(`/appointments/${id}/${action}/`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['availability'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}
