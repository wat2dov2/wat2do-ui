"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Takes live components out of the interaction and accessibility trees, so
 * they show as a picture of the app: the landing page's previews, and the
 * club page as the club panel previews it.
 */
export function Inert({ className, children }: { className?: string; children: ReactNode }) {
  return (
    // React 18 has no `inert` prop, so the attribute is set on the element directly.
    <div ref={(node) => node?.setAttribute("inert", "")} aria-hidden="true" className={cn("w-full select-none", className)}>
      {children}
    </div>
  );
}
