import React from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal, X } from "@/shared/ui/doodle-icons";
import { Popover, PopoverAnchor, PopoverContent } from "@/shared/ui/popover";

interface MoreFiltersButtonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filterCount: number;
  onClearFilters?: () => void;
  children: React.ReactNode;
}

export function MoreFiltersButton({
  open,
  onOpenChange,
  filterCount,
  onClearFilters,
  children,
}: MoreFiltersButtonProps) {
  const { t } = useTranslation();

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>
        <button
          type="button"
          data-elevation="control"
          onMouseDown={(e) => {
            if (e.button !== 0) return;

            e.preventDefault();
            onOpenChange(!open);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;

            e.preventDefault();
            onOpenChange(!open);
          }}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
            open || filterCount > 0
              ? "bg-primary/80 text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
          }`}
        >
          <SlidersHorizontal className="size-3.5" />
          {t("common.moreFilters")}
          {filterCount > 0 && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t("common.clearFilters", "Clear filters")}
              onMouseDown={(e) => {
                e.stopPropagation();
                onClearFilters?.();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onClearFilters?.();
                }
              }}
              className="bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full text-[10px] ml-1 flex items-center gap-1 hover:bg-primary/70 transition-colors cursor-pointer"
            >
              <X className="size-2.5" strokeWidth={3} />
              {filterCount}
            </span>
          )}
        </button>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[300px] max-h-[calc(100vh-200px)] overflow-y-auto p-4"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
