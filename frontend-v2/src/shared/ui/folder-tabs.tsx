import React from "react";
import { cn } from "@/shared/lib/utils";

interface FolderTabItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
  active?: boolean;
  onClick?: () => void;
}

interface FolderTabsProps {
  items: FolderTabItem[];
  className?: string;
}

export function FolderTabs({ items, className }: FolderTabsProps) {
  return (
    <div className={cn("folder-tab-stack", className)}>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className="folder-tab"
            data-active={item.active ? "true" : "false"}
            onClick={item.onClick}
            style={
              {
                "--tab-shift": item.active ? "10px" : "0px",
                "--tab-z": item.active ? 20 : 10,
              } as React.CSSProperties
            }
          >
            <span className="folder-tab-inner">
              <span className="folder-tab-label">{item.label}</span>
              <Icon className="h-4 w-4 shrink-0" strokeWidth={2.1} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

