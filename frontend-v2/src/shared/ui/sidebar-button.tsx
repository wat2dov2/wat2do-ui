import React from "react";
import { cn } from "@/shared/lib/utils";

interface SidebarButtonProps {
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number | string;
  }>;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  badge?: React.ReactNode;
  className?: string;
}

/**
 * Reusable sidebar button component
 * Reduces Tailwind class duplication across Sidebar
 */
export const SidebarButton = React.memo(function SidebarButton({
  icon: Icon,
  label,
  isActive = false,
  onClick,
  badge,
  className,
}: SidebarButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group/sidebar w-full font-medium text-[11px] rounded-xl text-left",
        "flex items-center px-2 py-1.5 gap-2",
        "text-muted-foreground transition-colors",
        "hover:bg-background/70 hover:text-foreground",
        isActive && "bg-background text-foreground shadow-[0_1px_0_rgba(255,255,255,0.75)_inset,0_10px_14px_-14px_rgba(45,30,20,0.5)]",
        className
      )}
    >
      <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
      <span className="flex-1 whitespace-nowrap transition-opacity duration-150 opacity-0 group-hover/sidebar:opacity-100">
        {label}
      </span>
      {badge}
    </button>
  );
});
