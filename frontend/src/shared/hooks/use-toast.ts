import type { ReactNode } from "react"
import { toast as sonnerToast } from "sonner"

type ToastVariant = "default" | "destructive" | "success"

interface ToastOptions {
  title?: ReactNode
  description?: ReactNode
  variant?: ToastVariant
  action?: {
    label: ReactNode
    onClick: () => void
  }
}

function toast({ title, description, variant = "default", action }: ToastOptions) {
  const message = title ?? description ?? ""
  const options = {
    description: title ? description : undefined,
    action,
  }

  if (variant === "destructive") {
    return sonnerToast.error(message, options)
  }

  if (variant === "success") {
    return sonnerToast.success(message, options)
  }

  if (title) {
    return sonnerToast(message, options)
  }

  return sonnerToast.message(message, { action })
}

export { toast }
