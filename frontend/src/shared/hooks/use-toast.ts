import type { ReactNode } from "react"
import { whenToasterReady } from "@/shared/ui/toaster-demand"

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

function toast({ title, description, variant = "default", action }: ToastOptions): void {
  const message = title ?? description ?? ""
  const options = {
    description: title ? description : undefined,
    action,
  }

  // The library loads with the Toaster on the first toast (see toaster-demand).
  whenToasterReady((sonnerToast) => {
    if (variant === "destructive") {
      sonnerToast.error(message, options)
    } else if (variant === "success") {
      sonnerToast.success(message, options)
    } else if (title) {
      sonnerToast(message, options)
    } else {
      sonnerToast.message(message, { action })
    }
  })
}

export { toast }
