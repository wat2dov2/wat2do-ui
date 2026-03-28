import React from 'react'
import { cn } from '../../lib/cn'

export type AlertProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: 'default' | 'info' | 'success' | 'warning' | 'destructive'
}

export function Alert({ className, variant = 'default', ...props }: AlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        'rounded-2xl border px-4 py-3 text-sm',
        variant === 'default' && 'border-black/10 bg-white/60 text-ink',
        variant === 'info' && 'border-sky/40 bg-sky/15 text-ink',
        variant === 'success' && 'border-sage/50 bg-sage/20 text-ink',
        variant === 'warning' && 'border-mustard/50 bg-mustard/20 text-ink',
        variant === 'destructive' && 'border-coral/50 bg-coral/15 text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mb-1 font-medium', className)} {...props} />
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-gray-700', className)} {...props} />
}
