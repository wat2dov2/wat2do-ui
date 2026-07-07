import { useCallback, useMemo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Grid3x3 } from "@/shared/ui/doodle-icons";
import { FilterSection } from "@/features/search/components/FilterSection";
import { MultiSelect } from "@/shared/ui/multi-select";
import { Switch } from "@/shared/ui/switch";
import { SearchCombobox } from "@/shared/ui/search-combobox";
import { Input } from "@/shared/ui/input";
import { Chip } from "@/shared/ui/chip";
import type { ViewMode } from "@/shared/types";

interface LocationFilterInputProps {
  value: string;
  onChange: (value: string[]) => void;
  placeholder: string;
}

function LocationFilterInput({ value, onChange, placeholder }: LocationFilterInputProps) {
  const [localValue, setLocalValue] = useState(value);

  // Sync with external updates (like clear all filters)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalValue(val);
    onChange(val.trim() ? [val.trim()] : []);
  };

  return (
    <Input
      type="text"
      placeholder={placeholder}
      value={localValue}
      onChange={handleChange}
    />
  );
}

interface VisualFiltersProps {
  filters: {
    selectedCategories: string[];
    setSelectedCategories: (categories: string[]) => void;
    categoryOptions: Array<{ id: string; label: string }>;
    toggleCategory: (id: string) => void;
    selectedLocations: string[];
    setSelectedLocations: (locations: string[]) => void;
    selectedFoods: string[];
    setSelectedFoods: (foods: string[]) => void;
    foodOptions: Array<{ id: string; label: string }>;
    toggleFood: (id: string) => void;
    selectedDays: string[];
    setSelectedDays: (days: string[]) => void;
    dayOptions: Array<{ id: string; label: string }>;
    toggleDay: (id: string) => void;
    priceRange: { min: string; max: string };
    setPriceRange: (range: { min: string; max: string }) => void;
    registration: boolean;
    setRegistration: (value: boolean) => void;
    selectedOrganizations: string[];
    setSelectedOrganizations: (value: string[]) => void;
    toggleOrganization: (org: string) => void;
    availableOrganizations: string[];
  };
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
  const foodValues = useMemo(
    () => filters.foodOptions.map((o) => o.id),
    [filters.foodOptions],
  );
  const foodLabels = useMemo(
    () => new Map(filters.foodOptions.map((o) => [o.id, o.label])),
    [filters.foodOptions],
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

  const handleSelectOrganization = useCallback(
    (org: string) => {
      if (filters.selectedOrganizations.includes(org)) {
        filters.setSelectedOrganizations([]);
      } else {
        filters.setSelectedOrganizations([org]);
      }
    },
    [filters],
  );

  const orgFetcher = useCallback(
    (query: string) => {
      return filters.availableOrganizations.filter((org) =>
        org.toLowerCase().includes(query.toLowerCase()),
      );
    },
    [filters.availableOrganizations],
  );

  return (
    <div className="-space-y-px">
      {/* View Mode */}
      <FilterSection
        title={t("common.view")}
        indicator={
          viewMode === "calendar"
            ? t("settings.appearance.calendar")
            : undefined
        }
        onClear={() => onViewModeChange("grid")}
      >
        <div className="grid grid-cols-2 gap-2">
          {viewModeOptions.map((option) => {
            const ViewIcon = option.icon;
            const active = viewMode === option.id;

            return (
              <Chip
                key={option.id}
                active={active}
                size="lg"
                onClick={() => onViewModeChange(option.id)}
                aria-pressed={active}
                icon={<ViewIcon className="size-3.5" />}
                className="w-full"
              >
                {option.label}
              </Chip>
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
        <LocationFilterInput
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
        <MultiSelect
          options={foodValues}
          selected={filters.selectedFoods}
          onToggle={filters.toggleFood}
          getLabel={(id) => foodLabels.get(id) ?? id}
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
          filters.selectedOrganizations.length > 0
            ? `${filters.selectedOrganizations.length}`
            : undefined
        }
        onClear={() => filters.setSelectedOrganizations([])}
      >
        <div className="space-y-2">
          {filters.availableOrganizations.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              {t("filters.noOrganizations")}
            </p>
          ) : (
            <SearchCombobox<string>
              selectedKey={filters.selectedOrganizations[0] ?? ""}
              onSelect={handleSelectOrganization}
              fetcher={orgFetcher}
              getKey={(org) => org}
              getLabel={(org) => org}
              displayValue={filters.selectedOrganizations[0] ?? t("forms.selectOrganization", "Select organization...")}
              isPlaceholder={filters.selectedOrganizations.length === 0}
              searchOnEmpty
              variant="field"
              searchPlaceholder={t("forms.searchOrganizationPlaceholder", "Search organizations...")}
              emptyLabel={t("forms.noOrganizationFound", "No organization found")}
              loadingLabel={t("common.loading")}
            />
          )}
        </div>
      </FilterSection>

      {/* Price Range Filter */}
      <FilterSection
        title={t("filters.priceRange")}
        indicator={
          filters.priceRange.min || filters.priceRange.max ? "1" : undefined
        }
        onClear={() => filters.setPriceRange({ min: "", max: "" })}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder={t("filters.minPrice")}
              value={filters.priceRange.min}
              onChange={(e) =>
                filters.setPriceRange({
                  ...filters.priceRange,
                  min: e.target.value,
                })
              }
            />
            <span className="text-muted-foreground text-xs">-</span>
            <Input
              type="number"
              placeholder={t("filters.maxPrice")}
              value={filters.priceRange.max}
              onChange={(e) =>
                filters.setPriceRange({
                  ...filters.priceRange,
                  max: e.target.value,
                })
              }
            />
          </div>
        </div>
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
