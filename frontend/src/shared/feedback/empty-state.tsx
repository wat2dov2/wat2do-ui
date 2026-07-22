import * as React from "react"

import { Stack } from "@/shared/layout/stack"
import { cn } from "@/shared/lib/utils"

type EmptyStateProps = React.ComponentProps<"div"> & {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center py-12 text-center",
        className
      )}
      {...props}
    >
      <Stack direction="vertical" gap={3} align="center">
        {icon ? (
          <div
            data-slot="empty-state-icon"
            className="text-muted-foreground [&_svg]:size-12"
          >
            {icon}
          </div>
        ) : null}
        <Stack direction="vertical" gap={1} align="center">
          <p
            data-slot="empty-state-title"
            className="font-medium text-foreground"
          >
            {title}
          </p>
          {description ? (
            <p
              data-slot="empty-state-description"
              className="max-w-md text-sm text-muted-foreground"
            >
              {description}
            </p>
          ) : null}
        </Stack>
        {action ? (
          <div data-slot="empty-state-action">{action}</div>
        ) : null}
      </Stack>
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
