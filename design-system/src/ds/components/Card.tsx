import React from 'react'
import { cx } from '../utils/cx'

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx('ds-card', className)}>
      <div className="ds-cardInner">{children}</div>
    </div>
  )
}
