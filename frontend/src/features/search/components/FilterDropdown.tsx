import { useTranslation } from "react-i18next";
import {
  VisualFilters,
  type VisualFilterControls,
} from "@/features/search/components/VisualFilters";

interface FilterDropdownProps {
  school: string;
  filters: VisualFilterControls;
}

export function FilterDropdown({
  school,
  filters,
}: FilterDropdownProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="mb-3">
        <h2 className="font-semibold text-base text-foreground">{t("filters.filtersHeader")}</h2>
      </div>

      <VisualFilters
        school={school}
        filters={filters}
      />
    </>
  );
}
