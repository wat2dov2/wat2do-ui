import { ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"

export function InteractiveHoverButton({
  children,
  className,
  hideDot = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  hideDot?: boolean;
}) {
  return (
    <button
      className={cn(
        "interactive-hover-button bg-background relative w-auto cursor-pointer overflow-hidden rounded-xl border p-2 px-10 text-center font-semibold flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-center gap-2 w-full">
        {!hideDot && (
          <div className="bg-primary h-2 w-2 rounded-full transition-all duration-300 [.interactive-hover-button:hover_&]:scale-[100.8]"></div>
        )}
        <span className="inline-flex items-center justify-center gap-1.5 transition-all duration-300 [.interactive-hover-button:hover_&]:translate-x-12 [.interactive-hover-button:hover_&]:opacity-0">
          {children}
        </span>
      </div>
      <div className="absolute top-0 left-0 z-10 flex h-full w-full translate-x-12 items-center justify-center gap-2 opacity-0 transition-all duration-300 [.interactive-hover-button:hover_&]:translate-x-0 [.interactive-hover-button:hover_&]:opacity-100">
        <span className="inline-flex items-center justify-center gap-1.5">{children}</span>
        <ArrowRight className="w-4 h-4" />
      </div>
    </button>
  )
}
