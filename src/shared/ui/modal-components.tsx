/**
 * Reusable Modal Components
 * Reduces Tailwind class duplication across modals
 */

import React from "react";
import { cn } from "@/shared/lib/utils";

/**
 * Modal Section - Common section wrapper
 */
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

/**
 * Info Row - Common info display pattern
 */
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
  return (
    <div className={cn("space-y-1", className)} {...props}>
      <h3 className="font-semibold text-sm text-gray-900">{label}</h3>
      <p className="text-sm text-muted-foreground">{value}</p>
    </div>
  );
}

/**
 * Info Grid - Two-column info layout
 */
export function InfoGrid({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Modal Image Container - Standardized image container
 */
export function ModalImageContainer({
  src,
  alt,
  fallback,
  className,
  size = "md",
  ...props
}: {
  src?: string;
  alt: string;
  fallback?: React.ReactNode;
  size?: "sm" | "md" | "lg";
} & React.ComponentProps<"div">) {
  const sizeClasses = {
    sm: "w-32 h-32",
    md: "w-64 h-64",
    lg: "w-full h-64",
  };

  return (
    <div
      className={cn(
        "rounded-lg overflow-hidden border border-border bg-gradient-to-br from-primary/20 to-primary/5",
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className="w-full h-full object-cover"
        />
      ) : (
        fallback || (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-16 h-16 text-muted-foreground/30" />
          </div>
        )
      )}
    </div>
  );
}

/**
 * Status Badge - Common status badge pattern
 */
export function StatusBadge({
  isActive,
  activeLabel,
  inactiveLabel,
  className,
  ...props
}: {
  isActive: boolean;
  activeLabel: string;
  inactiveLabel: string;
  className?: string;
} & React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-xs px-2 py-1 rounded-full",
        isActive
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
        className
      )}
      {...props}
    >
      {isActive ? activeLabel : inactiveLabel}
    </span>
  );
}

/**
 * Modal Content Wrapper - Standardized content padding
 */
export function ModalContentWrapper({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("px-6 pb-6", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Modal Header Wrapper - Standardized header padding
 */
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

/**
 * Empty State - Common empty state pattern
 */
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
      <Icon className="w-12 h-12 mx-auto mb-3 opacity-50" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm">{description}</p>
    </div>
  );
}
