import React from 'react'
import { cn } from '../../lib/cn'

export type SpinnerProps = React.SVGAttributes<SVGSVGElement> & {
  label?: string
}

export function Spinner({ className, label = 'Loading', ...props }: SpinnerProps) {
  return (
    <svg
      className={cn('h-5 w-5 animate-spin text-coral', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-label={label}
      role="status"
      {...props}
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
