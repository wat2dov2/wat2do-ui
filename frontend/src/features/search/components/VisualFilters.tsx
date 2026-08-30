import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Grid3x3 } from "@/shared/ui/doodle-icons";
import { FilterSection } from "@/features/search/components/FilterSection";
import { MultiSelect } from "@/shared/ui/multi-select";
import { Switch } from "@/shared/ui/switch";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { FormGrid } from "@/shared/layout";
import type { ViewMode } from "@/shared/types";

interface SingleValueFilterInputProps {
  value: string;
  onChange: (value: string[]) => void;
  placeholder: string;
}

function SingleValueFilterInput({ value, onChange, placeholder }: SingleValueFilterInputProps) {
  return (
    <Input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(event) => {
        const nextValue = event.target.value;
        onChange(nextValue.trim() ? [nextValue] : []);
      }}
    />
  );
}

export interface VisualFilterControls {
  selectedCategories: string[];
  setSelectedCategories: (categories: string[]) => void;
  categoryOptions: Array<{ id: string; label: string }>;
  toggleCategory: (id: string) => void;
  selectedLocations: string[];
  setSelectedLocations: (locations: string[]) => void;
  selectedFoods: string[];
  setSelectedFoods: (foods: string[]) => void;
  selectedDays: string[];
  setSelectedDays: (days: string[]) => void;
  dayOptions: Array<{ id: string; label: string }>;
  toggleDay: (id: string) => void;
  minPrice: string;
  setMinPrice: (value: string) => void;
  maxPrice: string;
  setMaxPrice: (value: string) => void;
  registration: boolean;
  setRegistration: (value: boolean) => void;
  selectedOrganizations: string[];
  setSelectedOrganizations: (value: string[]) => void;
}

interface VisualFiltersProps {
  filters: VisualFilterControls;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function VisualFilters({ filters, viewMode, onViewModeChange }: VisualFiltersProps) {
  const { t } = useTranslation();

  const categoryValues = useMemo(
    () => filters.categoryOptions.map((o) => o.id),
    [filters.categoryOptions],
  );
  const categoryLabels = useMemo(
    () => new Map(filters.categoryOptions.map((o) => [o.id, o.label])),
    [filters.categoryOptions],
  );
  const dayValues = useMemo(
    () => filters.dayOptions.map((o) => o.id),
    [filters.dayOptions],
  );
  const dayLabels = useMemo(
    () => new Map(filters.dayOptions.map((o) => [o.id, o.label])),
    [filters.dayOptions],
  );

  const viewModeOptions = useMemo(
    () => [
      { id: "grid" as const, label: t("settings.appearance.grid"), icon: Grid3x3 },
      { id: "calendar" as const, label: t("settings.appearance.calendar"), icon: Calendar },
    ],
    [t],
  );
  const activePriceFilterCount =
    Number(Boolean(filters.minPrice)) + Number(Boolean(filters.maxPrice));

  return (
    <div className="-space-y-px">
      {/* View Mode */}
      <FilterSection title={t("common.view")}>
        <div className="grid grid-cols-2 gap-2">
          {viewModeOptions.map((option) => {
            const ViewIcon = option.icon;
            const active = viewMode === option.id;

            return (
              <Button
                key={option.id}
                variant={active ? "primary" : "outline"}
                onClick={() => onViewModeChange(option.id)}
                aria-pressed={active}
                className="w-full"
              >
                <ViewIcon className="size-3.5" />
                {option.label}
              </Button>
            );
          })}
        </div>
      </FilterSection>

      {/* Category Filter */}
      <FilterSection
        title={t("filters.category")}
        indicator={
          filters.selectedCategories.length > 0
            ? `${filters.selectedCategories.length}`
            : undefined
        }
        onClear={() => filters.setSelectedCategories([])}
      >
        <MultiSelect
          options={categoryValues}
          selected={filters.selectedCategories}
          onToggle={filters.toggleCategory}
          getLabel={(id) => categoryLabels.get(id) ?? id}
        />
      </FilterSection>

      {/* Location Filter (free-text: filter events by location substring) */}
      <FilterSection
        title={t("filters.location")}
        indicator={
          (filters.selectedLocations[0]?.trim() ?? "") ? "1" : undefined
        }
        onClear={() => filters.setSelectedLocations([])}
      >
        <SingleValueFilterInput
          value={filters.selectedLocations[0] ?? ""}
          onChange={filters.setSelectedLocations}
          placeholder={t("forms.locationPlaceholder")}
        />
      </FilterSection>

      {/* Food Filter */}
      <FilterSection
        title={t("filters.food")}
        indicator={
          filters.selectedFoods.length > 0
            ? `${filters.selectedFoods.length}`
            : undefined
        }
        onClear={() => filters.setSelectedFoods([])}
      >
        <SingleValueFilterInput
          value={filters.selectedFoods[0] ?? ""}
          onChange={filters.setSelectedFoods}
          placeholder={t("filters.searchFood")}
        />
      </FilterSection>

      {/* Day of Week Filter */}
      <FilterSection
        title={t("filters.dayOfWeek")}
        indicator={
          filters.selectedDays.length > 0
            ? `${filters.selectedDays.length}`
            : undefined
        }
        onClear={() => filters.setSelectedDays([])}
      >
        <MultiSelect
          options={dayValues}
          selected={filters.selectedDays}
          onToggle={filters.toggleDay}
          getLabel={(id) => dayLabels.get(id) ?? id}
        />
      </FilterSection>

      {/* Organization Filter */}
      <FilterSection
        title={t("filters.organization", "Organization")}
        indicator={
          filters.selectedOrganizations[0]?.trim()
            ? "1"
            : undefined
        }
        onClear={() => filters.setSelectedOrganizations([])}
      >
        <SingleValueFilterInput
          value={filters.selectedOrganizations[0] ?? ""}
          onChange={filters.setSelectedOrganizations}
          placeholder={t("filters.searchOrganization")}
        />
      </FilterSection>

      {/* Price Range Filter */}
      <FilterSection
        title={t("filters.price")}
        indicator={
          activePriceFilterCount > 0
            ? String(activePriceFilterCount)
            : undefined
        }
        onClear={() => {
          filters.setMinPrice("");
          filters.setMaxPrice("");
        }}
      >
        <FormGrid columns={2} collapse={false} className="gap-2">
          <Input
            type="number"
            min="0"
            step="0.01"
            aria-label={t("filters.min")}
            placeholder={t("filters.min")}
            value={filters.minPrice}
            onChange={(event) => filters.setMinPrice(event.target.value)}
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            aria-label={t("filters.max")}
            placeholder={t("filters.max")}
            value={filters.maxPrice}
            onChange={(event) => filters.setMaxPrice(event.target.value)}
          />
        </FormGrid>
      </FilterSection>

      {/* Requires Registration Filter */}
      <FilterSection
        title={t("filters.registration")}
        indicator={filters.registration ? "1" : undefined}
        onClear={() => filters.setRegistration(false)}
      >
        <div className="flex justify-start">
          <Switch
            aria-label={t("filters.registration")}
            checked={filters.registration}
            onCheckedChange={(checked) =>
              filters.setRegistration(!!checked)
            }
          />
        </div>
      </FilterSection>
    </div>
  );
}
