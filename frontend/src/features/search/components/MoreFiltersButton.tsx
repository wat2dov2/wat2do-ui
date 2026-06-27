import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "@/shared/ui/doodle-icons";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
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

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>
        <button
          type="button"
          data-elevation="control"
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
            open || filterCount > 0
              ? "bg-primary/80 text-primary-foreground"
              : "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60"
          }`}
        >
          {t("common.moreFilters")}
          {filterCount > 0 && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t("common.clearFilters", "Clear filters")}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
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
      </DrawerTrigger>
      <DrawerContent className="max-h-[85dvh] overflow-hidden p-0">
        <DrawerHeader className="sr-only">
          <DrawerTitle>{t("common.moreFilters")}</DrawerTitle>
          <DrawerDescription>{t("filters.filtersHeader")}</DrawerDescription>
        </DrawerHeader>
        <div className="max-h-[calc(85dvh-1.5rem)] overflow-y-auto px-2 py-3 sm:p-4">
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
