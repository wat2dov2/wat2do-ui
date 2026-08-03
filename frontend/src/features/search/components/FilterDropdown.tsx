import { useTranslation } from "react-i18next";
import { VisualFilters } from "@/features/search/components/VisualFilters";
import type { ViewMode } from "@/shared/types";

interface FilterOption {
  id: string;
  label: string;
}

interface FilterDropdownFilters {
  // Category filters
  selectedCategories: string[];
  setSelectedCategories: (categories: string[]) => void;
  categoryOptions: FilterOption[];
  toggleCategory: (id: string) => void;
  // Location filters
  selectedLocations: string[];
  setSelectedLocations: (locations: string[]) => void;
  // Food filters
  selectedFoods: string[];
  setSelectedFoods: (foods: string[]) => void;
  foodOptions: FilterOption[];
  // Day of week filters
  selectedDays: string[];
  setSelectedDays: (days: string[]) => void;
  dayOptions: FilterOption[];
  toggleDay: (id: string) => void;
  // Price & registration
  maxPrice: string;
  setMaxPrice: (value: string) => void;
  registration: boolean;
  setRegistration: (value: boolean) => void;
  // Organization
  selectedOrganizations: string[];
  setSelectedOrganizations: (value: string[]) => void;
  toggleOrganization: (org: string) => void;
  availableOrganizations: string[];
}

interface FilterDropdownProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  filters: FilterDropdownFilters;
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
