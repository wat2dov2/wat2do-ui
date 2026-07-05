import React from "react";
import { X } from "@/shared/ui/doodle-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/ui/tooltip";

interface FilterSectionProps {
  title: string;
  children: React.ReactNode;
  indicator?: string;
  onClear?: () => void;
}

export const FilterSection = React.memo(function FilterSection({
  title,
  children,
  indicator,
  onClear,
}: FilterSectionProps) {

  return (
    <div className="space-y-2 relative -mx-4 border-y border-border">
      <div className="flex items-center justify-between w-full px-4 py-3">
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
                e.preventDefault();
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
              className="bg-secondary text-foreground font-medium text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ring-1 ring-border/80 hover:bg-muted/60 transition-colors cursor-pointer"
            >
              <X className="size-2.5" strokeWidth={3} />
              {indicator}
            </span>
          )}
        </div>
      </div>
      <div className="px-4 pb-3">{children}</div>
    </div>
  );
});
