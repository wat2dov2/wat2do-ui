import * as React from "react"

import { cn } from "@/shared/lib/utils"

const containerSizes = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-6xl",
  full: "max-w-none",
} as const

type ContainerSize = keyof typeof containerSizes

type ContainerProps = React.ComponentProps<"div"> & {
  size?: ContainerSize
}

function Container({ size = "lg", className, ...props }: ContainerProps) {
  return (
    <div
      data-slot="container"
      className={cn("mx-auto w-full", containerSizes[size], className)}
      {...props}
    />
  )
}

export { Container }
export type { ContainerProps, ContainerSize }
