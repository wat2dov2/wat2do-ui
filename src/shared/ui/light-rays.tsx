import React from "react";
import { cn } from "@/shared/lib/utils";

export function LightRays({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 -z-10",
        "bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))]",
        "from-primary/20 via-transparent to-transparent",
        className
      )}
      aria-hidden="true"
    />
  );
}

