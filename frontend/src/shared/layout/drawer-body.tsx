import * as React from "react"

import { cn } from "@/shared/lib/utils"

type DrawerBodyProps = React.ComponentProps<"div">

function DrawerBody({ className, ...props }: DrawerBodyProps) {
  return (
    <div
      data-slot="drawer-body"
      className={cn("flex flex-col gap-6 p-4 sm:p-6", className)}
      {...props}
    />
  )
}

export { DrawerBody }
export type { DrawerBodyProps }
