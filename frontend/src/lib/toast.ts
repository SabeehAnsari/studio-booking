import { createContext, useContext } from 'react'

export type ToastTone = 'success' | 'info'
export type ShowToast = (message: string, tone?: ToastTone) => void

export const ToastContext = createContext<ShowToast>(() => {})

export function useToast() {
  return useContext(ToastContext)
}
