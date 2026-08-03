import * as React from "react"

import { cn } from "@/shared/lib/utils"

type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: "default" | "lg"
}

function Input({ className, type, size = "default", ...props }: InputProps) {
  return (
    <input
      type={type}
      data-slot="input"
      data-elevation="control"
      data-size={size}
      className={cn(
        "flex w-full min-w-0 items-center rounded-xl bg-secondary px-3 py-2 text-base text-secondary-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground hover:bg-secondary-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-50 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm md:text-sm",
        size === "lg" ? "h-11" : "h-9",
        className
      )}
      {...props}
    />
  )
}

export { Input }
