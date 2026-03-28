import React from 'react'
import { cx } from '../utils/cx'

export type TextTone = 'default' | 'strong' | 'muted' | 'danger'

export type TextProps<T extends keyof JSX.IntrinsicElements> = {
  as?: T
  tone?: TextTone
  className?: string
  children: React.ReactNode
} & Omit<JSX.IntrinsicElements[T], 'as' | 'className' | 'children'>

export function Text<T extends keyof JSX.IntrinsicElements = 'p'>({
  as,
  tone = 'default',
  className,
  children,
  ...props
}: TextProps<T>) {
  const Comp = (as ?? 'p') as unknown as React.ElementType
  return (
    <Comp {...props} className={cx('ds-text', className)} data-tone={tone}>
      {children}
    </Comp>
  )
}
