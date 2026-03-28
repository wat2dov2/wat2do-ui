import React from 'react'
import { cx } from '../utils/cx'

export type StackProps = React.HTMLAttributes<HTMLDivElement> & {
  gap?: number
  direction?: 'row' | 'column'
  align?: 'start' | 'center' | 'end'
  justify?: 'start' | 'center' | 'between'
}

export function Stack({
  className,
  gap = 12,
  direction = 'column',
  align = 'start',
  justify = 'start',
  style,
  ...props
}: StackProps) {
  return (
    <div
      {...props}
      className={cx('ds-stack', className)}
      data-direction={direction}
      data-align={align}
      data-justify={justify}
      style={{ gap, ...style }}
    />
  )
}
