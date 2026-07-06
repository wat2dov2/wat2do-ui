import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "@/shared/ui/doodle-icons";
import { Chip } from "@/shared/ui/chip";
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
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Chip
        active={open || filterCount > 0}
        size="md"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        data-elevation="control"
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
            className="bg-background/18 text-background px-1.5 h-4 rounded-full text-[10px] ml-1 flex items-center gap-0.5 hover:bg-background/24 dark:bg-[#1c1917]/12 dark:text-[#1c1917] dark:hover:bg-[#1c1917]/18 transition-colors cursor-pointer"
          >
            <X className="size-2" strokeWidth={3} />
            {filterCount}
          </span>
        )}
      </Chip>
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
