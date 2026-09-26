/**
 * Shared modal layout primitives to reduce Tailwind class duplication.
 */

import React from "react";
import { cn } from "@/shared/lib/utils";

export function ModalContentWrapper({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("px-6 pt-5 pb-6 space-y-5", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function ModalHeaderWrapper({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("px-6 pt-6 pb-0", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
  ...props
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  className?: string;
} & React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-center py-12 text-muted-foreground border border-border rounded-xl",
        className
      )}
      {...props}
    >
      <Icon className="size-12 mx-auto mb-3 opacity-50" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm">{description}</p>
    </div>
  );
}
