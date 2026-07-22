import * as React from "react"

import { cn } from "@/shared/lib/utils"

function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      data-elevation="control"
      className={cn(
        "min-h-[80px] w-full rounded-xl bg-secondary px-3 py-2 text-base text-secondary-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground hover:bg-secondary-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-50 resize-none md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
