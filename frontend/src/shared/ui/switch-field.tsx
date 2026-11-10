"use client"

import * as React from "react"

import { cn } from "@/shared/lib/utils"
import { Field, FieldDescription, FieldLabel } from "@/shared/ui/field"
import { Skeleton } from "@/shared/ui/skeleton"
import { Switch } from "@/shared/ui/switch"

interface SwitchFieldProps {
  /** Generated when omitted. */
  id?: string
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** Holds the switch's place with a skeleton while its value loads. */
  loading?: boolean
  className?: string
}

/**
 * One setting turned on or off: its label and description on the left, the
 * switch pinned to the right edge and centred on the label's first line,
 * however far the description wraps.
 */
function SwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  loading,
  className,
}: SwitchFieldProps) {
  const generatedId = React.useId()
  const switchId = id ?? generatedId
  const descriptionId = description ? `${switchId}-description` : undefined
  return (
    <Field
      orientation="horizontal"
      data-slot="switch-field"
      data-disabled={disabled ? true : undefined}
      className={cn("items-start justify-between gap-4", className)}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <FieldLabel htmlFor={switchId} className="w-auto leading-5">
          {label}
        </FieldLabel>
        {description ? (
          <FieldDescription id={descriptionId}>{description}</FieldDescription>
        ) : null}
      </div>
      {/* As tall as the label's line, so the switch centres on it. */}
      <div className="flex h-5 shrink-0 items-center">
        {loading ? (
          <Skeleton className="h-6 w-11 rounded-full" />
        ) : (
          <Switch
            id={switchId}
            checked={checked}
            disabled={disabled}
            onCheckedChange={onCheckedChange}
            aria-describedby={descriptionId}
          />
        )}
      </div>
    </Field>
  )
}

export { SwitchField }
export type { SwitchFieldProps }
