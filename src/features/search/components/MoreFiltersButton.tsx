import React from "react";
import { useTranslation } from "react-i18next";
import { SlidersHorizontal, X } from "lucide-react";

interface MoreFiltersButtonProps {
  isOpen: boolean;
  filterCount: number;
  onToggle: () => void;
}

export function MoreFiltersButton({
  isOpen,
  filterCount,
  onToggle,
}: MoreFiltersButtonProps) {
  const { t } = useTranslation();

  return (
    <div className="relative">
      <button
        data-filter-trigger
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
          isOpen || filterCount > 0
            ? "bg-primary/80 text-white"
            : "bg-muted text-muted-foreground hover:bg-muted/80 dark:hover:bg-muted/60"
        }`}
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        {t("common.moreFilters")}
        {filterCount > 0 && (
          <span className="bg-primary text-white px-1.5 py-0.5 rounded-full text-[10px] ml-1 flex items-center gap-1">
            <X className="w-2.5 h-2.5" strokeWidth={3} />
            {filterCount}
          </span>
        )}
      </button>
    </div>
  );
}
