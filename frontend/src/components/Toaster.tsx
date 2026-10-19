import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type ToastTone } from '../lib/toast'

type Toast = { id: number; message: string; tone: ToastTone }

const DURATION_MS = 4000

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const show = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = nextId.current++
      setToasts((all) => [...all.slice(-2), { id, message, tone }])
      window.setTimeout(() => dismiss(id), DURATION_MS)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-line bg-surface py-3 pr-2 pl-4 text-sm shadow-lg"
          >
            <span
              className={`grid size-5 shrink-0 place-items-center rounded-full text-xs ${
                toast.tone === 'success' ? 'bg-good-soft text-good' : 'bg-brand-soft text-brand'
              }`}
              aria-hidden="true"
            >
              {toast.tone === 'success' ? '✓' : 'i'}
            </span>
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="ml-1 grid size-7 place-items-center rounded-md text-ink-muted hover:bg-line/60 hover:text-ink"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
