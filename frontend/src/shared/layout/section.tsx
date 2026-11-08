import * as React from "react"

import { Stack } from "@/shared/layout/stack"
import { Separator } from "@/shared/ui/separator"
import { cn } from "@/shared/lib/utils"

type SectionProps = React.ComponentProps<"section"> & {
  title?: React.ReactNode
  description?: React.ReactNode
  /** Controls for the whole section (See all, scroll arrows), at the end of its title row. */
  actions?: React.ReactNode
  variant?: "plain" | "surface" | "divided"
}

function Section({
  title,
  description,
  actions,
  variant = "plain",
  className,
  children,
  ...props
}: SectionProps) {
  const hasHeader = Boolean(title || description)
  const header = <SectionHeader title={title} description={description} variant={variant} />

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
      {hasHeader && actions ? (
        <Stack direction="horizontal" align="center" justify="between" gap={2}>
          {header}
          <Stack data-slot="section-actions" direction="horizontal" align="center" gap={1} className="shrink-0">
            {actions}
          </Stack>
        </Stack>
      ) : hasHeader ? header : null}
      {children}
    </section>
  )
}

function SectionHeader({ title, description, variant }: Pick<SectionProps, "title" | "description" | "variant">) {
  return (
    <Stack direction="vertical" gap={variant === "divided" ? 2 : 1} className="min-w-0">
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
  )
}

export { Section }
export type { SectionProps }
