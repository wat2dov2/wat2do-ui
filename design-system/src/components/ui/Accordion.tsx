import React, { createContext, useContext, useState } from 'react'
import { cn } from '../../lib/cn'

type AccordionCtx = {
  open: string | null
  setOpen: (v: string | null) => void
}

const AccordionContext = createContext<AccordionCtx | null>(null)

export function Accordion({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <AccordionContext.Provider value={{ open, setOpen }}>
      <div className={cn('flex flex-col gap-2', className)}>{children}</div>
    </AccordionContext.Provider>
  )
}

export type AccordionItemProps = {
  value: string
  title: string
  children: React.ReactNode
  className?: string
}

export function AccordionItem({ value, title, children, className }: AccordionItemProps) {
  const ctx = useContext(AccordionContext)
  if (!ctx) throw new Error('AccordionItem must be inside Accordion')
  const isOpen = ctx.open === value

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl bg-[#EDE9E2]/80 ring-1 ring-black/8',
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-ink hover:bg-black/[0.03]"
        aria-expanded={isOpen}
        onClick={() => ctx.setOpen(isOpen ? null : value)}
      >
        {title}
        <span className="text-gray-500" aria-hidden>
          {isOpen ? '−' : '+'}
        </span>
      </button>
      {isOpen ? (
        <div className="border-t border-black/8 px-4 py-3 text-sm text-gray-700">{children}</div>
      ) : null}
    </div>
  )
}
