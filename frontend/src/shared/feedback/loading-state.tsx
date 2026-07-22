import * as React from "react"
import { useTranslation } from "react-i18next"

import { Stack } from "@/shared/layout/stack"
import { cn } from "@/shared/lib/utils"
import { Spinner } from "@/shared/ui/spinner"

const spinnerSizes = {
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
} as const

type LoadingStateSize = keyof typeof spinnerSizes

type LoadingStateProps = React.ComponentProps<"div"> & {
  label?: string
  size?: LoadingStateSize
}

function LoadingState({
  label,
  size = "md",
  className,
  ...props
}: LoadingStateProps) {
  const { t } = useTranslation()
  const text = label ?? t("common.loading")

  return (
    <div
      data-slot="loading-state"
      className={cn(
        "flex flex-col items-center justify-center py-12",
        className
      )}
      role="status"
      aria-live="polite"
      aria-label={text}
      {...props}
    >
      <Stack direction="vertical" gap={3} align="center">
        <Spinner className={spinnerSizes[size]} />
        {text ? (
          <p
            data-slot="loading-state-label"
            className="text-sm text-muted-foreground"
          >
            {text}
          </p>
        ) : null}
      </Stack>
    </div>
  )
}

export { LoadingState }
export type { LoadingStateProps, LoadingStateSize }
