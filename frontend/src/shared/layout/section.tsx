import * as React from "react"

import { Stack } from "@/shared/layout/stack"
import { Separator } from "@/shared/ui/separator"
import { cn } from "@/shared/lib/utils"

type SectionProps = React.ComponentProps<"section"> & {
  title?: React.ReactNode
  description?: React.ReactNode
  variant?: "plain" | "surface" | "divided"
}

function Section({
  title,
  description,
  variant = "plain",
  className,
  children,
  ...props
}: SectionProps) {
  const hasHeader = Boolean(title || description)

  return (
    <section
      data-slot="section"
      data-variant={variant}
      className={cn(
        "space-y-3",
        variant === "surface" &&
          "bg-surface border border-border rounded-xl p-6",
        className
      )}
      {...props}
    >
      {hasHeader ? (
        <Stack direction="vertical" gap={variant === "divided" ? 2 : 1}>
          {title ? (
            <h2
              data-slot="section-title"
              className={cn("font-semibold text-foreground", variant === "divided" ? "text-sm" : "text-lg")}
            >
              {title}
            </h2>
          ) : null}
          {variant === "divided" && title ? <Separator /> : null}
          {description ? (
            <p
              data-slot="section-description"
              className="text-sm text-muted-foreground"
            >
              {description}
            </p>
          ) : null}
        </Stack>
      ) : null}
      {children}
    </section>
  )
}

export { Section }
export type { SectionProps }
