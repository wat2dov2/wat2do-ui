import React from 'react'
import { cn } from '../../lib/cn'

export type SeparatorProps = React.HTMLAttributes<HTMLDivElement> & {
  orientation?: 'horizontal' | 'vertical'
}

export function Separator({
  className,
  orientation = 'horizontal',
  role = 'separator',
  'aria-orientation': ariaOrientation,
  ...props
}: SeparatorProps) {
  return (
    <div
      role={role}
      aria-orientation={ariaOrientation ?? (orientation === 'vertical' ? 'vertical' : undefined)}
      className={cn(
        'shrink-0 bg-black/10',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px min-h-[1rem]',
        className,
      )}
      {...props}
    />
  )
}
