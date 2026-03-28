import React from 'react'
import { cn } from '../../lib/cn'

export type ProgressProps = React.HTMLAttributes<HTMLDivElement> & {
  value: number
  max?: number
}

export function Progress({
  className,
  value,
  max = 100,
  ...props
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn('h-2.5 w-full overflow-hidden rounded-full bg-[#E0D9CF]', className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-linear-to-r from-sage to-sky transition-[width] duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
