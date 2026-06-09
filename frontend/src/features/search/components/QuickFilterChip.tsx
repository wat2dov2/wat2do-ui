import React from "react";

interface QuickFilterChipProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onMouseDown: () => void;
  badge?: number;
}

export function QuickFilterChip({ icon, label, active, onMouseDown, badge }: QuickFilterChipProps) {
  return (
    <button
      onMouseDown={onMouseDown}
      data-elevation="control"
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
        active
          ? "bg-primary/80 text-primary-foreground"
          : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="bg-foreground/30 text-primary-foreground px-1.5 py-0.5 rounded-full text-[10px]">
          {badge}
        </span>
      )}
    </button>
  );
}
