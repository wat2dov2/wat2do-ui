import * as React from "react"

import { cn } from "@/shared/lib/utils"

type FormLayoutProps = React.ComponentProps<"form">

/**
 * Brings the first field a submit found missing or wrong into view and
 * focuses it. Its error is drawn by the render the submit caused, so the
 * field is looked for on the next frame.
 */
function revealFirstInvalidField(form: HTMLFormElement) {
  requestAnimationFrame(() => {
    const field = form.querySelector<HTMLElement>("[aria-invalid=true]")
    if (!field) return
    field.scrollIntoView({ block: "center", behavior: "smooth" })
    field.focus({ preventScroll: true })
  })
}

/**
 * A form's frame. Its submit button stays enabled: a submit that finds
 * something missing marks those fields, and the form shows the first of them.
 */
function FormLayout({ className, onSubmit, ...props }: FormLayoutProps) {
  return (
    <form
      data-slot="form-layout"
      className={cn("space-y-8", className)}
      onSubmit={(event) => {
        const form = event.currentTarget
        onSubmit?.(event)
        revealFirstInvalidField(form)
      }}
      {...props}
    />
  )
}

export { FormLayout }
export type { FormLayoutProps }
