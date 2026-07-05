"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

import { useDarkMode } from "@/shared/hooks/useDarkMode"

export function Toaster({ ...props }: ToasterProps) {
  const { isDarkMode } = useDarkMode()

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
