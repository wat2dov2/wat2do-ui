import React from 'react'
import { cn } from '../../lib/cn'

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'coral' | 'mustard' | 'sage' | 'sky' | 'outline'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variant === 'default' && 'bg-black/5 text-ink',
        variant === 'coral' && 'bg-coral/15 text-ink',
        variant === 'mustard' && 'bg-mustard/20 text-ink',
        variant === 'sage' && 'bg-sage/25 text-ink',
        variant === 'sky' && 'bg-sky/25 text-ink',
        variant === 'outline' && 'border border-ink/20 bg-transparent text-ink',
        className,
      )}
      {...props}
    />
  )
}
