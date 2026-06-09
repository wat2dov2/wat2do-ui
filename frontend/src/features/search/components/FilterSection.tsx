import React from "react";
import { ChevronUp, ChevronDown, X } from "@/shared/ui/doodle-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/ui/tooltip";

interface FilterSectionProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  indicator?: string;
  onClear?: () => void;
}

export const FilterSection = React.memo(function FilterSection({
  title,
  expanded,
  onToggle,
  children,
  indicator,
  onClear,
}: FilterSectionProps) {

  return (
    <div className={`space-y-2 relative -mx-4 ${expanded ? "border-y border-border" : ""}`}>
      <button
        onMouseDown={onToggle}
        className="flex items-center justify-between w-full group hover:opacity-80 transition-opacity py-3 px-4"
      >
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-medium text-xs relative text-foreground cursor-default">
                {title}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{title}</p>
            </TooltipContent>
          </Tooltip>
          {indicator && (
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear ${title}`}
              onMouseDown={(e) => {
                e.stopPropagation();
                onClear?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onClear?.();
                }
              }}
              className="text-primary-foreground font-medium text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 hover:opacity-90 transition-colors cursor-pointer bg-primary"
            >
              <X className="size-2.5" strokeWidth={3} />
              {indicator}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="size-4 transition-colors text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 transition-colors text-muted-foreground" />
        )}
      </button>
      {expanded && <div className="animate-in fade-in duration-200 px-4 pb-3">{children}</div>}
    </div>
  );
});
