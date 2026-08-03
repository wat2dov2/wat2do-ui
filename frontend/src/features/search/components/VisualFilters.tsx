import { useCallback, useMemo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Grid3x3 } from "@/shared/ui/doodle-icons";
import { FilterSection } from "@/features/search/components/FilterSection";
import { MultiSelect } from "@/shared/ui/multi-select";
import { Switch } from "@/shared/ui/switch";
import { SearchCombobox } from "@/shared/ui/search-combobox";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import type { ViewMode } from "@/shared/types";

interface SingleValueFilterInputProps {
  value: string;
  onChange: (value: string[]) => void;
  placeholder: string;
}

function SingleValueFilterInput({ value, onChange, placeholder }: SingleValueFilterInputProps) {
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
    selectedDays: string[];
    setSelectedDays: (days: string[]) => void;
    dayOptions: Array<{ id: string; label: string }>;
    toggleDay: (id: string) => void;
    maxPrice: string;
    setMaxPrice: (value: string) => void;
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
      <FilterSection title={t("common.view")}>
        <div className="grid grid-cols-2 gap-2">
          {viewModeOptions.map((option) => {
            const ViewIcon = option.icon;
            const active = viewMode === option.id;

            return (
              <Button
                key={option.id}
                variant={active ? "primary" : "secondary"}
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

      {/* Maximum Price Filter */}
      <FilterSection
        title={t("filters.maxPrice")}
        indicator={filters.maxPrice ? "1" : undefined}
        onClear={() => filters.setMaxPrice("")}
      >
        <Input
          type="number"
          min="0"
          placeholder={t("filters.maxPrice")}
          value={filters.maxPrice}
          onChange={(event) => filters.setMaxPrice(event.target.value)}
        />
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
