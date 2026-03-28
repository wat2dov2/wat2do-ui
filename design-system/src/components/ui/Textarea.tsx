import React from 'react'
import { cn } from '../../lib/cn'

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 4, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full resize-y rounded-2xl border-0 bg-[#EDE9E2] px-4 py-3 text-sm text-ink placeholder:text-gray-500 outline-none ring-1 ring-transparent transition focus:ring-2 focus:ring-coral/50 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
})
