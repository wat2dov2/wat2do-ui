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
      <h3 className="font-semibold text-sm text-foreground">{label}</h3>
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
        "rounded-lg overflow-hidden border border-border bg-linear-to-br from-primary/20 to-primary/5",
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
            <div className="size-16 text-muted-foreground/30" />
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
          ? "bg-success/20 text-success"
          : "bg-secondary text-muted-foreground",
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
      className={cn("px-6 pt-5 pb-6 space-y-5", className)}
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
      <Icon className="size-12 mx-auto mb-3 opacity-50" />
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm">{description}</p>
    </div>
  );
}

/**
 * Modal Image Header - Standardized image header with gradient overlay
 */
export function ModalImageHeader({
  src,
  alt,
  fallback,
  className,
  height = "h-64",
  ...props
}: {
  src?: string;
  alt: string;
  fallback?: React.ReactNode;
  height?: string;
  className?: string;
} & React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative w-full overflow-hidden",
        height,
        className
      )}
      {...props}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        fallback || (
          <div className="absolute inset-0 bg-linear-to-br from-muted to-muted/80 flex items-center justify-center">
            <div className="size-12 text-muted-foreground/40" />
          </div>
        )
      )}
    </div>
  );
}

/**
 * Info Section - Standardized info section with border separator
 */
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

/**
 * Section Title - Standardized section title
 */
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

/**
 * Action Button Group - Standardized button group for modal actions
 */
export function ActionButtonGroup({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex gap-2 justify-end mt-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Centered Icon Container - Standardized icon container for success/status states
 */
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

/**
 * Food Tags Container - Standardized food tags display
 */
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

/**
 * Food Tag - Individual food tag
 */
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

/**
 * Modal Stats Grid - Standardized stats grid layout
 */
export function ModalStatsGrid({
  children,
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 sm:grid-cols-4 gap-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Flex Row - Standardized flex row with gap
 */
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

/**
 * Flex Col - Standardized flex column with gap
 */
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
