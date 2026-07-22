import * as React from "react"

import { cn } from "@/shared/lib/utils"

type FormActionsProps = React.ComponentProps<"div"> & {
  align?: "start" | "end" | "between"
}

const alignClasses = {
  start: "justify-start",
  end: "justify-end",
  between: "justify-between",
} as const

function FormActions({
  align = "end",
  className,
  ...props
}: FormActionsProps) {
  return (
    <div
      data-slot="form-actions"
      className={cn(
        "flex gap-3 border-t border-border pt-6",
        alignClasses[align],
        className
      )}
      {...props}
    />
  )
}

export { FormActions }
export type { FormActionsProps }
