import { memo } from "react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

interface SidebarButtonProps {
  icon: ComponentType<{
    className?: string;
    strokeWidth?: number | string;
  }>;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  badge?: ReactNode;
  className?: string;
}

/**
 * Reusable sidebar button component
 * Reduces Tailwind class duplication across Sidebar
 */
export const SidebarButton = memo(function SidebarButton({
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
        "hover:bg-muted/60 hover:text-foreground",
        isActive && "bg-muted text-foreground",
        className
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={2} />
      <span className="flex-1 whitespace-nowrap transition-opacity duration-150 opacity-0 group-hover/sidebar:opacity-100">
        {label}
      </span>
      {badge}
    </button>
  );
});
