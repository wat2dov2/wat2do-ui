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
          ? "bg-primary text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,0_10px_14px_-12px_rgba(45,30,20,0.45)]"
          : "bg-muted text-muted-foreground hover:bg-secondary"
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="bg-foreground/20 text-foreground px-1.5 py-0.5 rounded-full text-[10px]">
          {badge}
        </span>
      )}
    </button>
  );
}
