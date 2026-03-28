import React from 'react'
import { cn } from '../../lib/cn'

export type RadioGroupProps = {
  value: string
  onValueChange: (v: string) => void
  className?: string
  children: React.ReactNode
}

export function RadioGroup({ value, onValueChange, className, children }: RadioGroupProps) {
  return (
    <div role="radiogroup" className={cn('flex flex-col gap-2', className)}>
      {React.Children.map(children, (child) => {
        if (!React.isValidElement<RadioGroupItemProps>(child)) return child
        return React.cloneElement(child, {
          _checked: child.props.value === value,
          _onSelect: () => onValueChange(child.props.value),
        })
      })}
    </div>
  )
}

export type RadioGroupItemProps = {
  value: string
  label: React.ReactNode
  className?: string
  disabled?: boolean
  /** @internal injected by RadioGroup */
  _checked?: boolean
  /** @internal injected by RadioGroup */
  _onSelect?: () => void
}

export function RadioGroupItem({
  label,
  className,
  disabled,
  _checked: checked = false,
  _onSelect: onSelect,
}: RadioGroupItemProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex items-start gap-3 rounded-xl p-3 text-left ring-1 transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F6F3ED]',
        checked
          ? 'bg-[#EDE9E2] ring-coral/40'
          : 'bg-[#EDE9E2]/60 ring-transparent hover:bg-[#EDE9E2]',
        disabled ? 'pointer-events-none opacity-45' : 'cursor-pointer',
        className,
      )}
    >
      <span
        className={cn(
          'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          checked ? 'border-sage bg-sage/30' : 'border-ink/35 bg-[#EDE9E2]',
        )}
      >
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-ink" />}
      </span>
      <span className="text-sm text-ink">{label}</span>
    </button>
  )
}
