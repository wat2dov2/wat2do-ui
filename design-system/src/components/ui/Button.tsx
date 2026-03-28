import React from 'react'
import { cn } from '../../lib/cn'

const base =
  'inline-flex items-center justify-center rounded-full font-medium transition select-none disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F6F3ED]'

const sizes = {
  sm: 'px-3.5 py-2 text-xs',
  md: 'px-5 py-2.5 text-sm',
} as const

const variants = {
  primary:
    'bg-sage text-ink shadow-[0_10px_24px_rgba(169,209,142,0.25)] hover:shadow-[0_14px_30px_rgba(169,209,142,0.28)] hover:scale-[1.02] focus-visible:ring-sage/50',
  secondary:
    'border-2 border-ink/70 bg-transparent text-ink hover:border-ink/80 hover:bg-coral/10 hover:scale-[1.02] focus-visible:ring-coral/50',
  ghost:
    'text-ink hover:bg-black/5 focus-visible:ring-coral/50',
} as const

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(base, sizes[size], variants[variant], className)}
      {...props}
    />
  )
})
