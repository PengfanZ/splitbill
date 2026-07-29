import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export function useDismissibleMenu() {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const root = rootRef.current!
    const closeOutside = (event: PointerEvent) => {
      if (!event.composedPath().includes(root)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const closeAndFocusTrigger = () => {
    setOpen(false)
    triggerRef.current!.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') closeAndFocusTrigger()
  }

  return {
    closeAndFocusTrigger,
    handleKeyDown,
    open,
    rootRef,
    toggle: () => setOpen(current => !current),
    triggerRef,
  }
}
