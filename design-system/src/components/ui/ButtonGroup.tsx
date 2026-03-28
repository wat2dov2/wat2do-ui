import React from 'react'
import { cn } from '../../lib/cn'

export type ButtonGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Accessible label when the group has no visible text */
  'aria-label'?: string
}

export function ButtonGroup({ className, role = 'group', ...props }: ButtonGroupProps) {
  return <div role={role} className={cn('flex flex-wrap items-center gap-2', className)} {...props} />
}
