import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "@/shared/ui/doodle-icons";
import { Button } from "@/shared/ui/button";
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
      <div className="flex items-center gap-1">
        <Button
          variant={open || filterCount > 0 ? "selected" : "secondary"}
          size="sm"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          {t("common.extraFilters")}
        </Button>
        {filterCount > 0 && (
          <Button
            type="button"
            variant="selected"
            size="xs"
            aria-label={t("common.clearFilters", "Clear filters")}
            onClick={() => {
              onClearFilters?.();
            }}
          >
            <X className="size-2 shrink-0" strokeWidth={3} />
            {filterCount}
          </Button>
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
