import React from 'react'
import { cn } from '../../lib/cn'

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(function Label(
  { className, ...props },
  ref,
) {
  return (
    <label
      ref={ref}
      className={cn('text-sm font-medium text-ink', className)}
      {...props}
    />
  )
})
