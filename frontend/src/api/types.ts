export type Role = 'admin' | 'staff' | 'customer'

export interface User {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  full_name: string
  phone: string
  role: Role
  is_demo: boolean
}

export interface AuthResponse {
  access: string
  refresh: string
  user: User
}

export interface AppConfig {
  business_name: string
  timezone: string
  slot_interval_minutes: number
  min_notice_minutes: number
  max_days_ahead: number
  cancellation_cutoff_hours: number
  demo_mode: boolean
  payments_enabled: boolean
  payment_provider: 'stripe' | 'demo' | null
  payments_test_mode: boolean
  currency: string
}

export interface Service {
  id: number
  name: string
  category: string
  category_label: string
  description: string
  duration_minutes: number
  price: string
  /** Paid online when booking; the rest is due at the studio. "0.00" = no deposit. */
  deposit: string
  is_active: boolean
  /** Only present on the /services/ listing. */
  next_available?: { start: string; staff_id: number } | null
}

export interface WorkingHours {
  weekday: number
  start_time: string
  end_time: string
}

export interface StaffMember {
  id: number
  name: string
  title: string
  bio: string
  service_ids: number[]
  working_hours: WorkingHours[]
}

export interface Slot {
  start: string
  end: string
  staff_ids: number[]
}

export interface AvailabilityResponse {
  service: number
  timezone: string
  days: { date: string; slots: Slot[] }[]
}

export type AppointmentStatus =
  | 'awaiting_payment'
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'expired'

export interface PaymentSummary {
  status: 'pending' | 'paid' | 'expired' | 'refunded'
  amount: string
  currency: string
}

export interface Appointment {
  id: number
  service: Service
  staff: StaffMember
  customer: User
  start: string
  end: string
  status: AppointmentStatus
  price: string
  notes: string
  hold_expires_at: string | null
  reminder_sent_at: string | null
  payment: PaymentSummary | null
  cancelled_at: string | null
  created_at: string
}

export interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface Dashboard {
  today_count: number
  upcoming_14d_count: number
  revenue_month_to_date: string | number
  booked_revenue_rest_of_month: string | number
  cancellation_rate_30d: number
  customers_count: number
  upcoming_by_day: { date: string; count: number }[]
  top_services: { name: string; count: number }[]
  staff_load: { id: number; name: string; count: number }[]
}

export interface DemoCheckoutSession {
  id: string
  status: 'open' | 'complete' | 'expired'
  amount: string
  currency: string
  product_name: string
  description: string
  customer_email: string
  expires_at: string
  cancel_url: string
}

export interface TimeOff {
  id: number
  start: string
  end: string
  reason: string
}

/** A booking affected by a schedule change. */
export interface AppointmentBrief {
  id: number
  start: string
  end: string
  service: string
  customer: string
}
