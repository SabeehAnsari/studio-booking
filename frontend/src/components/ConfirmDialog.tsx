import { useEffect, useRef, type ReactNode } from 'react'
import { Button, ErrorMessage } from './ui'

/**
 * Modal confirmation built on the native <dialog> element, which gives us focus trapping,
 * Escape-to-close and an inert background for free.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Go back',
  destructive = false,
  pending = false,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  pending?: boolean
  error?: unknown
  onConfirm: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault() // Escape: route through onClose so React state stays the source of truth.
        if (!pending) onClose()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose() // backdrop click
      }}
      className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-6">
        <h2 id="confirm-title" className="font-display text-xl font-semibold">
          {title}
        </h2>
        {children && <div className="mt-3 text-sm text-ink-soft">{children}</div>}
        {Boolean(error) && (
          <div className="mt-4">
            <ErrorMessage error={error} />
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={pending} autoFocus>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} loading={pending}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}
