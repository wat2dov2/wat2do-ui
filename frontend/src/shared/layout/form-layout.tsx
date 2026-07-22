import * as React from "react"

import { cn } from "@/shared/lib/utils"

type FormLayoutProps = React.ComponentProps<"form">

function FormLayout({ className, ...props }: FormLayoutProps) {
  return (
    <form
      data-slot="form-layout"
      className={cn("space-y-8", className)}
      {...props}
    />
  )
}

export { FormLayout }
export type { FormLayoutProps }
