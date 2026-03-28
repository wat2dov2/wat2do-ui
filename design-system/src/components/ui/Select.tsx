import React, { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/cn'

export type SelectOption = { value: string; label: string }

export type SelectProps = {
  options: SelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  id?: string
}

export function Select({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  placeholder = 'Select\u2026',
  disabled,
  className,
  id,
}: SelectProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? '')
  const isControlled = valueProp !== undefined
  const value = isControlled ? valueProp : uncontrolled
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const pick = (v: string) => {
    if (!isControlled) setUncontrolled(v)
    onValueChange?.(v)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && setOpen(!open)}
        className={cn(
          'flex w-full items-center justify-between rounded-2xl bg-[#EDE9E2] px-4 py-3 text-left text-sm text-ink outline-none ring-1 ring-transparent transition',
          'focus-visible:ring-2 focus-visible:ring-coral/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          !selected && 'text-gray-500',
        )}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          className={cn('text-ink/45 transition-transform', open && 'rotate-180')}
          aria-hidden
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-1.5 w-full rounded-2xl bg-[#FFFCF7] p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/10"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              onClick={() => pick(opt.value)}
              className={cn(
                'flex w-full cursor-pointer items-center rounded-xl px-3 py-2 text-left text-sm text-ink transition hover:bg-coral/10',
                opt.value === value && 'bg-sage/15 font-medium',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
