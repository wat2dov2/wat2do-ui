import React from 'react'
import { cn } from '../../lib/cn'

export type CheckboxProps = {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  label?: React.ReactNode
  className?: string
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { checked: checkedProp, defaultChecked, onCheckedChange, disabled, label, className, ...props },
  ref,
) {
  const [uncontrolled, setUncontrolled] = React.useState(!!defaultChecked)
  const isControlled = checkedProp !== undefined
  const checked = isControlled ? checkedProp : uncontrolled

  const toggle = () => {
    if (disabled) return
    const next = !checked
    if (!isControlled) setUncontrolled(next)
    onCheckedChange?.(next)
  }

  return (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        'flex items-center gap-3',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
        'focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition',
          'group-focus-visible:ring-2',
          checked ? 'border-sage bg-sage/80' : 'border-ink/35 bg-[#EDE9E2]',
        )}
      >
        {checked && (
          <svg
            className="h-3 w-3 text-ink"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label && <span className="text-sm text-ink select-none">{label}</span>}
    </button>
  )
})
