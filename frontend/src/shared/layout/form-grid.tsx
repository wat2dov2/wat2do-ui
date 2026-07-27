import * as React from "react"

import { cn } from "@/shared/lib/utils"

const columnClasses = {
  1: "grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  sidebar:
    "[&>:last-child]:order-first lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:[&>:last-child]:order-none",
} as const

type FormGridColumns = keyof typeof columnClasses

const fixedColumnClasses = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
} as const

type FormGridProps = React.ComponentProps<"div"> & {
  columns?: FormGridColumns
  as?: React.ElementType
  /** Keep the requested column count at every viewport width. */
  collapse?: boolean
}

function FormGrid({
  as: Component = "div",
  columns = 2,
  collapse = true,
  className,
  ...props
}: FormGridProps) {
  const responsiveColumns =
    !collapse && columns !== "sidebar"
      ? fixedColumnClasses[columns]
      : columnClasses[columns]

  return (
    <Component
      data-slot="form-grid"
      data-columns={columns}
      className={cn("grid gap-5", responsiveColumns, className)}
      {...props}
    />
  )
}

export { FormGrid }
export type { FormGridProps, FormGridColumns }
