import React from 'react'
import { cn } from '../../lib/cn'

export type FieldProps = React.HTMLAttributes<HTMLDivElement> & {
  label?: React.ReactNode
  htmlFor?: string
  description?: React.ReactNode
  error?: React.ReactNode
}

export function Field({
  className,
  label,
  htmlFor,
  description,
  error,
  children,
  ...props
}: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      {label ? (
        <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}
      {description ? <p className="text-xs text-gray-600">{description}</p> : null}
      {children}
      {error ? <p className="text-xs font-medium text-coral">{error}</p> : null}
    </div>
  )
}
