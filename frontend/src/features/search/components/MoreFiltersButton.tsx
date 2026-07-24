import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
import { FilterClearButton } from "@/shared/ui/filter-clear-button";
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
      <div className="relative w-fit">
        <Button
          variant={open || filterCount > 0 ? "primary" : "secondary"}
          size="sm"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
          className={filterCount > 0 ? "pr-11" : undefined}
        >
          {t("common.extraFilters")}
        </Button>
        {filterCount > 0 && (
          <FilterClearButton
            count={filterCount}
            label={t("common.clearFilters", "Clear filters")}
            onClick={() => onClearFilters?.()}
            className="absolute top-1/2 right-1 -translate-y-1/2"
          />
        )}
      </div>
      <DrawerContent className="max-h-[85dvh] max-w-sm! overflow-hidden p-0">
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
