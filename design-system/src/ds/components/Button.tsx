import React from 'react'
import { cx } from '../utils/cx'

export type ButtonVariant = 'primary' | 'default' | 'ghost'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

export function Button({ className, variant = 'default', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cx('ds-button', className)}
      data-variant={variant}
    />
  )
}
