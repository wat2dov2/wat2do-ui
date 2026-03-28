import React from 'react'
import { cn } from '../../lib/cn'

export type InputGroupProps = React.HTMLAttributes<HTMLDivElement>

export function InputGroup({ className, ...props }: InputGroupProps) {
  return (
    <div
      className={cn(
        'flex min-h-[46px] items-stretch overflow-hidden rounded-2xl bg-[#EDE9E2] ring-1 ring-transparent transition focus-within:ring-2 focus-within:ring-coral/50',
        className,
      )}
      {...props}
    />
  )
}

export type InputGroupAddonProps = React.HTMLAttributes<HTMLDivElement>

export function InputGroupAddon({ className, ...props }: InputGroupAddonProps) {
  return (
    <div
      className={cn(
        'flex items-center border-r border-black/10 bg-[#E3DDD4] px-3 text-sm text-gray-600',
        className,
      )}
      {...props}
    />
  )
}

export type InputGroupInputProps = React.InputHTMLAttributes<HTMLInputElement>

export const InputGroupInput = React.forwardRef<HTMLInputElement, InputGroupInputProps>(
  function InputGroupInput({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'min-w-0 flex-1 border-0 bg-transparent px-3 py-3 text-sm text-ink placeholder:text-gray-500 outline-none',
          className,
        )}
        {...props}
      />
    )
  },
)
