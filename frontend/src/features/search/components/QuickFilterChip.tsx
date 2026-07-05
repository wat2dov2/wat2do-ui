import React from "react";
import { useMouseDownAction } from "@/shared/hooks";

interface QuickFilterChipProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

export function QuickFilterChip({ icon, label, active, onClick }: QuickFilterChipProps) {
  const handleMouseDown = useMouseDownAction(onClick);

  return (
    <button
      type="button"
      onMouseDown={handleMouseDown}
      aria-pressed={active}
      data-elevation="control"
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
        active
          ? "bg-secondary text-foreground ring-1 ring-border/80 hover:bg-muted/60 dark:hover:bg-muted/60"
          : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
