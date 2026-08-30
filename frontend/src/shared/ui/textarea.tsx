import * as React from "react"

import { OUTLINE_CONTROL_STYLES } from "@/shared/ui/button"
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
        OUTLINE_CONTROL_STYLES,
        "min-h-[80px] w-full resize-none rounded-xl px-3 py-2 text-base transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
