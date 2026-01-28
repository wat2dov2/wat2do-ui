import React from "react";

interface NavButtonProps {
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number | string;
  }>;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  expanded: boolean;
}

export const NavButton = React.memo(function NavButton({
  icon: Icon,
  label,
  isActive = false,
  onClick,
  expanded,
}: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`font-medium text-[11px] rounded-xl text-left flex items-center px-2 py-1.5 gap-2 w-full cursor-pointer ${
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      }`}
    >
      <Icon className="w-4 h-4 shrink-0" strokeWidth={2} />
      <span
        className="whitespace-nowrap transition-opacity duration-150"
        style={{ opacity: expanded ? 1 : 0 }}
      >
        {label}
      </span>
    </button>
  );
});
