import React from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
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
        onClick={onToggle}
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
              onClick={(e) => {
                e.stopPropagation();
                onClear?.();
              }}
              className="text-white font-medium text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 hover:opacity-90 transition-colors cursor-pointer bg-primary"
            >
              <X className="w-2.5 h-2.5" strokeWidth={3} />
              {indicator}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 transition-colors text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 transition-colors text-muted-foreground" />
        )}
      </button>
      {expanded && <div className="animate-in fade-in duration-200 px-4 pb-3">{children}</div>}
    </div>
  );
});
