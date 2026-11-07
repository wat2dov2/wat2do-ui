"use client"

import { useEffect } from "react"
import { Toaster as Sonner, toast, type ToasterProps } from "sonner"

import { useDarkMode } from "@/shared/hooks/useDarkMode"
import { toasterMounted } from "@/shared/ui/toaster-demand"

export function Toaster({ ...props }: ToasterProps) {
  const { isDarkMode } = useDarkMode()
  // Runs after Sonner's own subscription (child effects run first), so the
  // toasts queued before the library loaded are shown, not dropped.
  useEffect(() => {
    toasterMounted(toast)
  }, [])

  return (
    <Sonner
      theme={isDarkMode ? "dark" : "light"}
      className="toaster group z-toast"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}
