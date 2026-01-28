import React from "react";
import { cn } from "@/shared/lib/utils";

interface TopNavButtonProps {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary";
  className?: string;
}

/**
 * Reusable top navigation button component
 * Reduces Tailwind class duplication in TopNav
 * Uses forwardRef to support Radix UI TooltipTrigger with asChild
 */
export const TopNavButton = React.memo(
  React.forwardRef<HTMLButtonElement, TopNavButtonProps>(function TopNavButton(
    {
      icon: Icon,
      children,
      onClick,
      variant = "default",
      className,
    },
    ref
  ) {
    const baseClasses = "flex items-center gap-1.5 font-medium text-sm px-3 py-1.5 rounded-xl transition-colors cursor-pointer";
    const variantClasses = {
      default: "bg-muted hover:bg-gray-200 text-foreground",
      primary: "bg-primary border-primary text-white min-w-[120px] justify-center",
    };

    return (
      <button
        ref={ref}
        onClick={onClick}
        className={cn(baseClasses, variantClasses[variant], className)}
      >
        {Icon && <Icon className="w-4 h-4" strokeWidth={2.5} />}
        {children}
      </button>
    );
  })
);
