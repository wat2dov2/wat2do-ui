import * as React from "react"

import { cn } from "@/shared/lib/utils"

const gapClasses = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  /** Matches the in-form field rhythm used by FormGrid and FormSection. */
  5: "gap-5",
  6: "gap-6",
  8: "gap-8",
  12: "gap-12",
} as const

type StackGap = keyof typeof gapClasses

type StackAlign = "start" | "center" | "end" | "stretch" | "baseline"
type StackJustify =
  | "start"
  | "center"
  | "end"
  | "between"
  | "around"
  | "evenly"

const alignClasses: Record<StackAlign, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
  baseline: "items-baseline",
}

const justifyClasses: Record<StackJustify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
  around: "justify-around",
  evenly: "justify-evenly",
}

type StackOwnProps = {
  as?: React.ElementType
  direction?: "vertical" | "horizontal"
  gap?: StackGap
  align?: StackAlign
  justify?: StackJustify
  /** Let children flow onto additional lines instead of overflowing. */
  wrap?: boolean
  /** Fill the remaining space in a parent flex layout. */
  grow?: boolean
}

type StackProps = StackOwnProps &
  Omit<React.ComponentPropsWithoutRef<"div">, keyof StackOwnProps>

function Stack({
  as: Component = "div",
  direction = "vertical",
  gap = 4,
  align,
  justify,
  wrap = false,
  grow = false,
  className,
  ...props
}: StackProps) {
  return (
    <Component
      data-slot="stack"
      className={cn(
        "flex",
        direction === "vertical" ? "flex-col" : "flex-row",
        gapClasses[gap],
        align && alignClasses[align],
        justify && justifyClasses[justify],
        wrap && "flex-wrap",
        grow && "flex-1",
        className
      )}
      {...props}
    />
  )
}

export { Stack }
export type { StackProps }
