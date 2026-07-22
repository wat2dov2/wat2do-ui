import * as React from "react"

import { cn } from "@/shared/lib/utils"

const columnClasses = {
  1: "grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 lg:grid-cols-3",
} as const

type FormGridColumns = keyof typeof columnClasses

type FormGridProps = React.ComponentProps<"div"> & {
  columns?: FormGridColumns
}

function FormGrid({
  columns = 2,
  className,
  ...props
}: FormGridProps) {
  return (
    <div
      data-slot="form-grid"
      data-columns={columns}
      className={cn("grid gap-5", columnClasses[columns], className)}
      {...props}
    />
  )
}

export { FormGrid }
export type { FormGridProps, FormGridColumns }
