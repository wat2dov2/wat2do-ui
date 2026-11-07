import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/shared/lib/utils"

interface HighlighterProps {
  children: ReactNode
  /** The marker colour drawn behind the text. */
  color?: string
  /** How far the marker reaches past the text on each side, in px. */
  padding?: number
  /** Extra classes for the highlighted wrapper (e.g. to bound its width so a
   * truncating child keeps the marker aligned to the visible text). */
  className?: string
}

/**
 * A marker highlight behind text, drawn with CSS (`.highlighter` in index.css).
 *
 * It used to be drawn by rough-notation, which inserted keyframes into the page
 * when it attached and redrew its SVG whenever the page body resized: on the
 * school name in the navigation that meant style work on every page and every
 * layout change. The marker now is a pseudo-element with a static stylesheet
 * animation, so nothing is injected or redrawn at runtime.
 */
export function Highlighter({ children, color = "var(--muted)", padding = 2, className }: HighlighterProps) {
  return (
    <span
      data-slot="highlighter"
      className={cn("highlighter", className)}
      style={{ "--highlighter-color": color, "--highlighter-padding": `${padding}px` } as CSSProperties}
    >
      {children}
    </span>
  )
}
