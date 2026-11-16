"use client"

import * as React from "react"

import { cn } from "@/shared/lib/utils"
import { Field, FieldDescription, FieldLabel } from "@/shared/ui/field"
import { Skeleton } from "@/shared/ui/skeleton"
import { Switch } from "@/shared/ui/switch"

type SwitchFieldProps = Omit<
  React.ComponentPropsWithoutRef<typeof Switch>,
  "id" | "children" | "className"
> & {
  id: string
  label: React.ReactNode
  /** Muted text under the label. */
  description?: React.ReactNode
  /** More lines under the description, such as extra notes. */
  children?: React.ReactNode
  /** Shows a switch-sized placeholder in place of the switch. */
  loading?: boolean
  /** `lg` for a settings page, where each switch heads its own section. */
  size?: "default" | "lg"
}

/**
 * A label (and optional description) on the start side with its switch at the
 * far end of the row, so the switch never sits right beside the text.
 * The text wraps; the switch keeps its size. With a description the switch lines
 * up with the label; a lone label is centred on it.
 */
function SwitchField({
  id,
  label,
  description,
  children,
  loading = false,
  size = "default",
  disabled,
  ...switchProps
}: SwitchFieldProps) {
  const multiline = description != null || children != null
  return (
    <Field
      orientation="horizontal"
      data-slot="switch-field"
      className={cn(
        "justify-between gap-4",
        multiline ? "items-start" : "items-center"
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <FieldLabel htmlFor={id} className={cn(size === "lg" && "text-base")}>
          {label}
        </FieldLabel>
        {description != null ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
        {children}
      </div>
      {loading ? (
        <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
      ) : (
        <Switch id={id} disabled={disabled} {...switchProps} />
      )}
    </Field>
  )
}

export { SwitchField }
export type { SwitchFieldProps }
