import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { useLocalization } from '../i18n/LocalizationContext'
import { IconButton } from './Button'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function ModalShell({
  bodyClassName = '',
  children,
  description,
  eyebrow,
  mobilePlacement = 'sheet',
  onClose,
  size = 'standard',
  title,
}: {
  bodyClassName?: string
  children: ReactNode
  description?: string
  eyebrow?: string
  mobilePlacement?: 'sheet' | 'center'
  onClose?: () => void
  size?: 'standard' | 'wide'
  title: string
}) {
  const { t } = useLocalization()
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  const previouslyFocusedRef = useRef(document.activeElement as HTMLElement | null)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current!
    const previouslyFocused = previouslyFocusedRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    const activeInsideDialog = document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)
      ? document.activeElement
      : null
    const requestedFocus = activeInsideDialog ?? focusable.find(element => element.autofocus)
    ;(requestedFocus ?? focusable[0] ?? dialog).focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closeRef.current) {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const available = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (!available.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = available[0]
      const last = available[available.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [])

  const dismissBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (onClose && event.currentTarget === event.target) onClose()
  }

  return (
    <div
      className={`modal-backdrop modal-backdrop--${mobilePlacement}`}
      role="presentation"
      onMouseDown={dismissBackdrop}
    >
      <section
        ref={dialogRef}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          {onClose ? (
            <IconButton className="dialog-close" label={t('common.close')} onClick={onClose}>
              <X size={20} />
            </IconButton>
          ) : null}
        </header>
        <div className={`modal-body${bodyClassName ? ` ${bodyClassName}` : ''}`}>{children}</div>
      </section>
    </div>
  )
}
