import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "@/shared/ui/doodle-icons";
import { useMouseDownAction } from "@/shared/hooks";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/shared/ui/drawer";

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
  const handleToggle = useMouseDownAction(() => onOpenChange(!open));

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <button
        type="button"
        data-elevation="control"
        aria-expanded={open}
        onMouseDown={handleToggle}
        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
          open || filterCount > 0
            ? "bg-foreground text-background hover:bg-foreground dark:bg-[#e7e5e4] dark:text-[#1c1917] dark:hover:bg-[#e7e5e4]"
            : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
        }`}
      >
        {t("common.extraFilters")}
        {filterCount > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("common.clearFilters", "Clear filters")}
            onMouseDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              event.stopPropagation();
              onClearFilters?.();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                onClearFilters?.();
              }
            }}
            className="bg-background/18 text-background px-1.5 py-0.5 rounded-full text-[10px] ml-1 flex items-center gap-1 hover:bg-background/24 dark:bg-[#1c1917]/12 dark:text-[#1c1917] dark:hover:bg-[#1c1917]/18 transition-colors cursor-pointer"
          >
            <X className="size-2.5" strokeWidth={3} />
            {filterCount}
          </span>
        )}
      </button>
      <DrawerContent className="max-h-[85dvh] !max-w-sm overflow-hidden p-0">
        <DrawerHeader className="sr-only">
          <DrawerTitle>{t("common.extraFilters")}</DrawerTitle>
          <DrawerDescription>{t("filters.filtersHeader")}</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[calc(85dvh-1.5rem)] overflow-y-auto p-4">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
