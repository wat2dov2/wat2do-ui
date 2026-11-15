import type { ReactNode } from "react"

import { cn } from "@/shared/lib/utils"

/**
 * Swaps between two icons (or two short labels) in one slot as wide as the
 * wider of them. Instead of a hard replacement, the outgoing one shrinks,
 * blurs and fades while the incoming one grows in from the same blur, so the
 * change reads as one turning into the other.
 */
export function IconSwap({
  showAlternate,
  icon,
  alternate,
}: {
  showAlternate: boolean
  icon: ReactNode
  alternate: ReactNode
}) {
  const layer =
    "col-start-1 row-start-1 transition-[opacity,scale,filter] duration-200 ease-[var(--ease-out-ui)] motion-reduce:transition-none"
  const hidden = "scale-50 opacity-0 blur-[2px]"

  return (
    <span data-slot="icon-swap" className="inline-grid place-items-center">
      <span aria-hidden={showAlternate} className={cn(layer, showAlternate && hidden)}>
        {icon}
      </span>
      <span aria-hidden={!showAlternate} className={cn(layer, !showAlternate && hidden)}>
        {alternate}
      </span>
    </span>
  )
}
