import React, { useCallback, useRef } from 'react'
import { cn } from '../../lib/cn'

export type SliderProps = {
  value?: number
  defaultValue?: number
  onChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  showValue?: boolean
  disabled?: boolean
  className?: string
  id?: string
}

export function Slider({
  value: valueProp,
  defaultValue = 0,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  showValue,
  disabled,
  className,
  id,
}: SliderProps) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue)
  const isControlled = valueProp !== undefined
  const value = isControlled ? valueProp : uncontrolled
  const trackRef = useRef<HTMLDivElement>(null)

  const pct = ((value - min) / (max - min)) * 100

  const commit = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const raw = ratio * (max - min) + min
      const stepped = Math.round(raw / step) * step
      const clamped = Math.min(max, Math.max(min, stepped))
      if (!isControlled) setUncontrolled(clamped)
      onChange?.(clamped)
    },
    [min, max, step, isControlled, onChange],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      commit(e.clientX)
    },
    [disabled, commit],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !e.buttons) return
      commit(e.clientX)
    },
    [disabled, commit],
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      let next = value
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(max, value + step)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(min, value - step)
      if (next !== value) {
        e.preventDefault()
        if (!isControlled) setUncontrolled(next)
        onChange?.(next)
      }
    },
    [disabled, value, min, max, step, isControlled, onChange],
  )

  return (
    <div className={cn('flex items-center gap-3', disabled && 'opacity-45', className)}>
      <div
        ref={trackRef}
        id={id}
        role="slider"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        className={cn(
          'relative h-3 flex-1 cursor-pointer rounded-full touch-none',
          'bg-[#C9C2BA] shadow-[inset_0_1px_3px_rgba(0,0,0,0.2)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F6F3ED]',
        )}
      >
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-linear-to-r from-sage to-sky shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]"
          style={{ width: `${pct}%` }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink/30 bg-cream shadow-[0_2px_6px_rgba(0,0,0,0.15)] ring-1 ring-white/60"
          style={{ left: `${pct}%` }}
        />
      </div>
      {showValue && (
        <span className="min-w-10 text-right font-mono text-xs text-gray-600">{value}</span>
      )}
    </div>
  )
}
