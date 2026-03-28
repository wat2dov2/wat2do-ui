import React from 'react'
import { cn } from '../../lib/cn'

export type SwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { className, checked: checkedProp, defaultChecked, onCheckedChange, disabled, type = 'button', ...props },
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
      type={type}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={toggle}
      className={cn(
        'relative inline-flex h-8 w-14 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F6F3ED]',
        checked
          ? 'bg-sage shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]'
          : 'bg-[#C0B8AE] shadow-[inset_0_2px_4px_rgba(0,0,0,0.18)]',
        disabled && 'cursor-not-allowed opacity-45',
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          'inline-block h-6 w-6 rounded-full transition-transform',
          'bg-cream border-2 shadow-[0_1px_4px_rgba(0,0,0,0.15)]',
          checked
            ? 'translate-x-7 border-sage/60'
            : 'translate-x-1 border-ink/15',
        )}
      />
    </button>
  )
})
