import * as React from "react";
import { X } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";

interface FilterClearButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  count: number;
  label: string;
}

const FilterClearButton = React.forwardRef<
  HTMLButtonElement,
  FilterClearButtonProps
>(({ className, count, label, onClick, ...props }, ref) => (
  <button
    ref={ref}
    {...props}
    type="button"
    aria-label={label}
    data-slot="filter-clear-button"
    onClick={(event) => {
      event.stopPropagation();
      onClick?.(event);
    }}
    className={cn(
      "flex h-5 min-w-5 items-center justify-center gap-1 rounded-full bg-primary-foreground/18 px-1.5 text-xs leading-none text-primary-foreground transition-colors hover:bg-surface-hover",
      className,
    )}
  >
    <X className="size-3 shrink-0" strokeWidth={3} />
    {count}
  </button>
));

FilterClearButton.displayName = "FilterClearButton";

export { FilterClearButton };
