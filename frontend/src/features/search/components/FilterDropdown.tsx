import { useTranslation } from "react-i18next";
import {
  VisualFilters,
  type VisualFilterControls,
} from "@/features/search/components/VisualFilters";

interface FilterDropdownProps {
  filters: VisualFilterControls;
}

export function FilterDropdown({
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
      />
    </>
  );
}
