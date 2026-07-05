import type { ReactNode } from "react"
import { toast as sonnerToast } from "sonner"

type ToastVariant = "default" | "destructive" | "success"

interface ToastOptions {
  title?: ReactNode
  description?: ReactNode
  variant?: ToastVariant
}

function toast({ title, description, variant = "default" }: ToastOptions) {
  const message = title ?? description ?? ""

  if (variant === "destructive") {
    return sonnerToast.error(message, {
      description: title ? description : undefined,
    })
  }

  if (variant === "success") {
    return sonnerToast.success(message, {
      description: title ? description : undefined,
    })
  }

  if (title) {
    return sonnerToast(message, { description })
  }

  return sonnerToast.message(message)
}

function useToast() {
  return {
    toast,
    dismiss: sonnerToast.dismiss,
    toasts: [],
  }
}

export { useToast, toast }
