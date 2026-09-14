import * as React from "react"

import { OUTLINE_CONTROL_STYLES } from "@/shared/ui/button"
import { cn } from "@/shared/lib/utils"

type InputProps = Omit<React.ComponentProps<"input">, "size"> & {
  size?: "default" | "lg" | "compact"
  format?: "integer"
}

function Input({ className, type, size = "default", format, onChange, ...props }: InputProps) {
  const lastValidValue = React.useRef(String(props.value ?? props.defaultValue ?? ""))
  return (
    <input
      data-slot="input"
      data-elevation="control"
      data-size={size}
      className={cn(
        OUTLINE_CONTROL_STYLES,
        "flex w-full min-w-0 items-center rounded-xl px-3 py-2 text-base transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:bg-muted disabled:cursor-not-allowed disabled:opacity-50 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm md:text-sm",
        size === "lg" ? "h-11" : size === "compact" ? "h-8 w-48 shrink-0 text-sm" : "h-9",
        className
      )}
      {...props}
      type={format === "integer" ? "text" : type}
      inputMode={format === "integer" ? "numeric" : props.inputMode}
      onChange={(event) => {
        const value = event.currentTarget.value
        if (format === "integer" && (!/^\d*$/.test(value) || (value !== "" && !Number.isSafeInteger(Number(value))))) {
          event.currentTarget.value = String(props.value ?? lastValidValue.current)
          return
        }
        lastValidValue.current = value
        onChange?.(event)
      }}
    />
  )
}

export { Input }
