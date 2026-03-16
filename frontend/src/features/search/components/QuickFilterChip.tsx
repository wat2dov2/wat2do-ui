import React from "react";

interface QuickFilterChipProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}

export function QuickFilterChip({ icon, label, active, onClick, badge }: QuickFilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
        active
          ? "bg-primary/80 text-white"
          : "bg-muted text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-200"
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="bg-foreground/30 text-white px-1.5 py-0.5 rounded-full text-[10px]">
          {badge}
        </span>
      )}
    </button>
  );
}
