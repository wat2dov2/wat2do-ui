import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '../../lib/cn'

type PopCtx = {
  open: boolean
  setOpen: (v: boolean) => void
}

const PopoverContext = createContext<PopCtx | null>(null)

export function Popover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <PopoverContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block text-left">{children}</div>
    </PopoverContext.Provider>
  )
}

export function PopoverTrigger({
  children,
}: {
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>
}) {
  const ctx = useContext(PopoverContext)
  if (!ctx) throw new Error('PopoverTrigger must be inside Popover')
  return React.cloneElement(children, {
    'aria-expanded': ctx.open,
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      children.props.onClick?.(e)
      ctx.setOpen(!ctx.open)
    },
  })
}

export function PopoverContent({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const ctx = useContext(PopoverContext)
  if (!ctx) throw new Error('PopoverContent must be inside Popover')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ctx.open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) ctx.setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ctx.setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [ctx, ctx.open])

  if (!ctx.open) return null

  return (
    <div
      ref={ref}
      className={cn(
        'absolute left-0 z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl bg-[#FFFCF7] p-4 text-sm text-gray-700 shadow-[0_14px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/10',
        className,
      )}
    >
      {children}
    </div>
  )
}
