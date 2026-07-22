import * as React from "react"

import { Stack } from "@/shared/layout/stack"
import { cn } from "@/shared/lib/utils"

type FormSectionProps = React.ComponentProps<"section"> & {
  title: React.ReactNode
  description?: React.ReactNode
}

function FormSection({
  title,
  description,
  className,
  children,
  ...props
}: FormSectionProps) {
  return (
    <section
      data-slot="form-section"
      className={cn("space-y-5", className)}
      {...props}
    >
      <Stack direction="vertical" gap={1}>
        <h2
          data-slot="form-section-title"
          className="text-lg font-semibold text-foreground"
        >
          {title}
        </h2>
        {description ? (
          <p
            data-slot="form-section-description"
            className="text-sm text-muted-foreground"
          >
            {description}
          </p>
        ) : null}
      </Stack>
      {children}
    </section>
  )
}

export { FormSection }
export type { FormSectionProps }
