import * as React from "react"

import { cn } from "@/shared/lib/utils"

function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-[80px] w-full resize-none rounded-xl border border-border bg-secondary px-3 py-2 text-base text-secondary-foreground shadow-[0_1px_0_rgba(255,255,255,0.75)_inset,0_10px_14px_-14px_rgba(45,30,20,0.5)] transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 disabled:bg-input/50 dark:disabled:bg-input/80 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
