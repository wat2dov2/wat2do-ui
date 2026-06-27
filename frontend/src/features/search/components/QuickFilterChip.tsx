import React from "react";

interface QuickFilterChipProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onMouseDown: () => void;
}

export function QuickFilterChip({ icon, label, active, onMouseDown }: QuickFilterChipProps) {
  return (
    <button
      onMouseDown={onMouseDown}
      data-elevation="control"
      className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
        active
          ? "bg-primary/80 text-primary-foreground"
          : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
