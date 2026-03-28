import React, { createContext, useContext, useEffect, useId, useRef } from 'react'
import { cn } from '../../lib/cn'
import { Button } from './Button'

type DialogCtx = {
  open: boolean
  setOpen: (v: boolean) => void
  titleId: string
  descId: string
}

const DialogContext = createContext<DialogCtx | null>(null)

export function Dialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const uid = useId()
  const titleId = `dlg-title-${uid}`
  const descId = `dlg-desc-${uid}`
  return (
    <DialogContext.Provider value={{ open, setOpen, titleId, descId }}>
      {children}
    </DialogContext.Provider>
  )
}

export function DialogTrigger({
  children,
}: {
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>
}) {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('DialogTrigger must be inside Dialog')
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      children.props.onClick?.(e)
      ctx.setOpen(true)
    },
  })
}

export type DialogContentProps = {
  title: string
  description?: string
  children?: React.ReactNode
  className?: string
}

export function DialogContent({ title, description, children, className }: DialogContentProps) {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('DialogContent must be inside Dialog')
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (ctx.open) {
      if (!el.open) el.showModal()
    } else {
      el.close()
    }
  }, [ctx.open])

  return (
    <dialog
      ref={ref}
      className={cn(
        'm-auto w-[min(100vw-2rem,28rem)] rounded-3xl border-0 bg-surface p-0 text-ink shadow-[0_25px_60px_rgba(0,0,0,0.35)] ring-1 ring-black/10',
        className,
      )}
      aria-labelledby={ctx.titleId}
      aria-describedby={description ? ctx.descId : undefined}
      onClose={() => ctx.setOpen(false)}
    >
      <div className="p-6">
        <h2 id={ctx.titleId} className="font-serif text-xl">
          {title}
        </h2>
        {description ? (
          <p id={ctx.descId} className="mt-2 text-sm text-gray-600">
            {description}
          </p>
        ) : null}
        <div className="mt-4">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={() => ctx.setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  )
}
