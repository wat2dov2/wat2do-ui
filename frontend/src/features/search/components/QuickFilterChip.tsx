import React from "react";
import { Chip } from "@/shared/ui/chip";

interface QuickFilterChipProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

export function QuickFilterChip({ icon, label, active, onClick }: QuickFilterChipProps) {
  return (
    <Chip
      active={active}
      size="md"
      icon={icon}
      onClick={onClick}
      aria-pressed={active}
      data-elevation="control"
    >
      {label}
    </Chip>
  );
}
