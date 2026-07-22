import * as React from "react"

import { Stack } from "@/shared/layout/stack"
import { cn } from "@/shared/lib/utils"

type PageHeaderProps = React.ComponentProps<"header"> & {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}

function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header data-slot="page-header" className={cn(className)} {...props}>
      <Stack
        direction="vertical"
        gap={4}
        className="sm:flex-row sm:items-start sm:justify-between"
      >
        <Stack direction="vertical" gap={1}>
          <h1
            data-slot="page-header-title"
            className="text-2xl font-semibold text-foreground"
          >
            {title}
          </h1>
          {description ? (
            <p
              data-slot="page-header-description"
              className="text-muted-foreground"
            >
              {description}
            </p>
          ) : null}
        </Stack>
        {actions ? (
          <div
            data-slot="page-header-actions"
            className="flex flex-wrap items-center gap-2"
          >
            {actions}
          </div>
        ) : null}
      </Stack>
    </header>
  )
}

export { PageHeader }
export type { PageHeaderProps }
