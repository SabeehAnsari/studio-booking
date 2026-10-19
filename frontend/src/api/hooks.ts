import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  AppConfig,
  Appointment,
  AvailabilityResponse,
  Dashboard,
  DemoCheckoutSession,
  Paginated,
  PaymentSummary,
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

export function useAppointment(id: number | undefined) {
  return useQuery({
    queryKey: ['appointments', 'detail', id],
    queryFn: () => api<Appointment>(`/appointments/${id}/`),
    enabled: id !== undefined,
  })
}

export function useCheckoutStatus(sessionId: string | null) {
  return useQuery({
    queryKey: ['checkout', sessionId],
    queryFn: () =>
      api<{ payment_status: PaymentSummary['status']; appointment: Appointment }>(`/payments/checkout/${sessionId}/`),
    enabled: Boolean(sessionId),
    // Stripe can take a moment to report the payment; keep checking until it settles.
    refetchInterval: (query) => (query.state.data?.payment_status === 'pending' ? 2000 : false),
  })
}

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard/') })
}

export function useCreateAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { service_id: number; staff_id: number; start: string; notes?: string }) =>
      api<Appointment & { checkout_url: string | null }>('/appointments/', { method: 'POST', json: body }),
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
      api<Appointment & { refunded_amount?: string | null }>(`/appointments/${id}/${action}/`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['availability'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

/** Reopens Stripe Checkout for a booking still awaiting its deposit, then leaves the app. */
export function usePayAppointment() {
  return useMutation({
    mutationFn: (id: number) => api<{ checkout_url: string }>(`/appointments/${id}/pay/`, { method: 'POST' }),
    onSuccess: ({ checkout_url }) => window.location.assign(checkout_url),
  })
}

export function useDemoCheckout(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['demo-checkout', sessionId],
    queryFn: () => api<DemoCheckoutSession>(`/payments/demo-checkout/${sessionId}/`),
    enabled: Boolean(sessionId),
  })
}

export function useDemoCheckoutPay(sessionId: string) {
  return useMutation({
    mutationFn: (outcome: 'success' | 'decline') =>
      api<{ redirect_url: string }>(`/payments/demo-checkout/${sessionId}/pay/`, { method: 'POST', json: { outcome } }),
  })
}
