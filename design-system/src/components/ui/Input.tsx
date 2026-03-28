import React from 'react'
import { cn } from '../../lib/cn'

export const inputClassName =
  'w-full rounded-2xl border-0 bg-[#EDE9E2] px-4 py-3 text-sm text-ink placeholder:text-gray-500 outline-none ring-1 ring-transparent transition focus:ring-2 focus:ring-coral/50 disabled:cursor-not-allowed disabled:opacity-50'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return <input ref={ref} type={type} className={cn(inputClassName, className)} {...props} />
})
