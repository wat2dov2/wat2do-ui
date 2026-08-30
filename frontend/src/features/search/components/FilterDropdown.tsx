import { useTranslation } from "react-i18next";
import {
  VisualFilters,
  type VisualFilterControls,
} from "@/features/search/components/VisualFilters";
import type { ViewMode } from "@/shared/types";

interface FilterDropdownProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  filters: VisualFilterControls;
}

export function FilterDropdown({
  viewMode,
  onViewModeChange,
  filters,
}: FilterDropdownProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="mb-3">
        <h2 className="font-semibold text-base text-foreground">{t("filters.filtersHeader")}</h2>
      </div>

      <VisualFilters
        filters={filters}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
      />
    </>
  );
}
