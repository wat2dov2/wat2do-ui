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
      <Button
        variant={open || filterCount > 0 ? "primary" : "secondary"}
        size="sm"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        {t("common.extraFilters")}
        {filterCount > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("common.clearFilters", "Clear filters")}
            onClick={(event) => {
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
            className="bg-primary-foreground/18 text-primary-foreground ml-1 flex h-3.5 items-center gap-0.5 rounded-full px-1 text-[10px] leading-none transition-colors hover:bg-surface-hover"
          >
            <X className="size-2 shrink-0" strokeWidth={3} />
            {filterCount}
          </span>
        )}
      </Button>
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
