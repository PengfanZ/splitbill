import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export type SelectMenuOption<Value extends string> = {
  value: Value
  label: string
  detail?: string
  leading?: ReactNode
  searchText?: string
}

type MenuPosition = {
  left: number
  top: number
  width: number
}

export function SelectMenu<Value extends string>({
  align = 'start',
  ariaLabel,
  autoFocus = false,
  className = '',
  description,
  menuLabel,
  onChange,
  options,
  renderValue,
  title,
  value,
  variant = 'field',
}: {
  align?: 'start' | 'end'
  ariaLabel: string
  autoFocus?: boolean
  className?: string
  description?: string
  menuLabel: string
  onChange: (value: Value) => void
  options: ReadonlyArray<SelectMenuOption<Value>>
  renderValue?: (option: SelectMenuOption<Value>) => ReactNode
  title?: string
  value: Value
  variant?: 'field' | 'compact'
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef('')
  const typeaheadTimerRef = useRef<number | null>(null)
  const selectedIndex = Math.max(0, options.findIndex(option => option.value === value))
  const selectedOption = options[selectedIndex]
  const assignMenuRef = useCallback((node: HTMLDivElement | null) => {
    menuRef.current = node
    node?.querySelectorAll<HTMLButtonElement>('[role="option"]')[activeIndex]?.focus()
  }, [activeIndex])

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current!
    const rect = trigger.getBoundingClientRect()
    const width = Math.max(rect.width, variant === 'compact' ? 320 : 220)
    const viewportPadding = 12
    const left = align === 'end'
      ? Math.max(viewportPadding, rect.right - width)
      : Math.min(rect.left, window.innerWidth - width - viewportPadding)
    setPosition({
      left: Math.max(viewportPadding, left),
      top: rect.bottom + 7,
      width: Math.min(width, window.innerWidth - viewportPadding * 2),
    })
  }, [align, variant])

  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    typeaheadRef.current = ''
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const openMenu = useCallback((index = selectedIndex) => {
    setActiveIndex(index)
    setOpen(true)
  }, [selectedIndex])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close()
    }
    const handleViewportChange = () => updatePosition()
    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [close, open, updatePosition])

  useEffect(() => () => {
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current)
  }, [])

  const select = (option: SelectMenuOption<Value>) => {
    onChange(option.value)
    close(true)
  }

  const findTypeaheadMatch = (query: string) => {
    const normalized = query.toLocaleLowerCase()
    return options.findIndex(option =>
      (option.searchText ?? `${option.label} ${option.detail ?? ''}`).toLocaleLowerCase().startsWith(normalized),
    )
  }

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'Tab') {
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      if (event.key === 'Home') setActiveIndex(0)
      else if (event.key === 'End') setActiveIndex(options.length - 1)
      else setActiveIndex(current => event.key === 'ArrowDown'
        ? (current + 1) % options.length
        : (current - 1 + options.length) % options.length)
      return
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
    typeaheadRef.current += event.key
    const match = findTypeaheadMatch(typeaheadRef.current)
    if (match >= 0) setActiveIndex(match)
    if (typeaheadTimerRef.current !== null) window.clearTimeout(typeaheadTimerRef.current)
    typeaheadTimerRef.current = window.setTimeout(() => {
      typeaheadRef.current = ''
    }, 500)
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(event.key === 'ArrowDown' ? selectedIndex : Math.max(0, selectedIndex - 1))
    }
  }

  if (!selectedOption) return null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`select-menu-trigger select-menu-trigger--${variant}${className ? ` ${className}` : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        value={value}
        autoFocus={autoFocus}
        onClick={() => open ? close() : openMenu()}
        onKeyDown={handleTriggerKeyDown}
      >
        {renderValue ? renderValue(selectedOption) : (
          <>
            {selectedOption.leading ? <span className="select-menu-leading">{selectedOption.leading}</span> : null}
            <span className="select-menu-value">
              <b>{selectedOption.label}</b>
              {selectedOption.detail ? <small>{selectedOption.detail}</small> : null}
            </span>
          </>
        )}
        <ChevronDown className={open ? 'select-menu-chevron select-menu-chevron--open' : 'select-menu-chevron'} size={16} aria-hidden="true" />
      </button>
      {open && position ? createPortal(
        <div
          ref={assignMenuRef}
          className={`select-menu-popover select-menu-popover--${variant}`}
          style={position}
          role="listbox"
          aria-label={menuLabel}
          onKeyDown={handleOptionKeyDown}
        >
          {title || description ? (
            <div className="select-menu-heading">
              {title ? <span>{title}</span> : null}
              {description ? <small>{description}</small> : null}
            </div>
          ) : null}
          <div className="select-menu-options">
            {options.map((option, index) => {
              const selected = option.value === value
              return (
                <button
                  type="button"
                  role="option"
                  aria-label={option.label}
                  aria-selected={selected}
                  className={`select-menu-option${selected ? ' select-menu-option--selected' : ''}`}
                  key={option.value}
                  tabIndex={index === activeIndex ? 0 : -1}
                  onClick={() => select(option)}
                  onFocus={() => setActiveIndex(index)}
                >
                  {option.leading ? <span className="select-menu-option-leading">{option.leading}</span> : null}
                  <span className="select-menu-option-copy">
                    <b>{option.label}</b>
                    {option.detail ? <small>{option.detail}</small> : null}
                  </span>
                  {selected ? <Check size={17} aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
