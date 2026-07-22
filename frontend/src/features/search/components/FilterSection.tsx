import React from "react";
import { X } from "@/shared/ui/doodle-icons";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/ui/tooltip";
import { Button } from "@/shared/ui/button";

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
            <Button
              variant="primary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onClear?.();
              }}
              aria-label={`Clear ${title}`}
            >
              <X className="size-2" strokeWidth={3} />
              {indicator}
            </Button>
          )}
        </div>
      </div>
      <div className="px-4 pb-3">{children}</div>
    </div>
  );
});
