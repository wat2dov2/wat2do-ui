/**
 * Shared modal layout primitives to reduce Tailwind class duplication.
 */

import React from "react";
import { cn } from "@/shared/lib/utils";

export function ModalSection({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("space-y-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function InfoRow({
  label,
  value,
  className,
  ...props
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
} & React.ComponentProps<"div">) {
  const isPlainTextValue = typeof value === "string" || typeof value === "number";

  return (
    <div className={cn("space-y-1", className)} {...props}>
      <h3 className="font-semibold text-sm text-foreground">{label}</h3>
      {isPlainTextValue ? (
        <p className="text-sm text-muted-foreground">{value}</p>
      ) : (
        <div className="text-sm text-muted-foreground">{value}</div>
      )}
    </div>
  );
}

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

export function InfoSection({
  children,
  className,
  showBorder = true,
  ...props
}: {
  showBorder?: boolean;
} & React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "space-y-4",
        showBorder && "border-t border-border pt-4 mt-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  children,
  className,
  ...props
}: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn(
        "font-semibold text-sm text-foreground mb-4",
        className
      )}
      {...props}
    >
      {children}
    </h3>
  );
}

export function CenteredIconContainer({
  icon: Icon,
  size = "md",
  className,
  ...props
}: {
  icon: React.ComponentType<Record<string, unknown>>;
  size?: "sm" | "md" | "lg";
  className?: string;
} & React.ComponentProps<"div">) {
  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-20 h-20",
  };

  const iconSizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-10 h-10",
  };

  return (
    <div
      className={cn(
        "rounded-full bg-linear-to-br from-amber-400 to-amber-500 flex items-center justify-center mb-4 mx-auto",
        sizeClasses[size],
        className
      )}
      {...props}
    >
      <Icon className={cn("text-primary-foreground", iconSizeClasses[size])} strokeWidth={3} />
    </div>
  );
}

export function FoodTagsContainer({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function FoodTag({
  children,
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-xs px-2 py-1 bg-warning/20 text-warning rounded-full",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function FlexRow({
  children,
  className,
  gap = "gap-4",
  ...props
}: {
  gap?: string;
} & React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center",
        gap,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function FlexCol({
  children,
  className,
  gap = "gap-4",
  ...props
}: {
  gap?: string;
} & React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col",
        gap,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
