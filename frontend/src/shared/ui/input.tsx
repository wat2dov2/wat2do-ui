import * as React from "react"

import { cn } from "@/shared/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      data-elevation="control"
      className={cn(
        "flex h-9 w-full min-w-0 items-center rounded-xl bg-secondary px-3 py-2 text-base text-secondary-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground hover:bg-secondary-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-50 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
