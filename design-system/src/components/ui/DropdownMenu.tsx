import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '../../lib/cn'

type MenuCtx = {
  open: boolean
  setOpen: (v: boolean) => void
}

const MenuContext = createContext<MenuCtx | null>(null)

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <MenuContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-block text-left">{children}</div>
    </MenuContext.Provider>
  )
}

export function DropdownMenuTrigger({
  children,
}: {
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>
}) {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error('DropdownMenuTrigger must be inside DropdownMenu')
  return React.cloneElement(children, {
    'aria-expanded': ctx.open,
    'aria-haspopup': 'menu',
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      children.props.onClick?.(e)
      ctx.setOpen(!ctx.open)
    },
  })
}

export function DropdownMenuContent({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error('DropdownMenuContent must be inside DropdownMenu')
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
      role="menu"
      className={cn(
        'absolute left-0 z-50 mt-2 min-w-[11rem] rounded-2xl bg-[#FFFCF7] p-1.5 shadow-[0_14px_40px_rgba(0,0,0,0.18)] ring-1 ring-black/10',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function DropdownMenuItem({
  className,
  children,
  onSelect,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?: () => void }) {
  const ctx = useContext(MenuContext)
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex w-full cursor-pointer items-center rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-coral/10',
        className,
      )}
      onClick={(e) => {
        props.onClick?.(e)
        onSelect?.()
        ctx?.setOpen(false)
      }}
      {...props}
    >
      {children}
    </button>
  )
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div className={cn('my-1 h-px bg-black/10', className)} role="separator" />
}
