import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Grid3x3 } from "@/shared/ui/doodle-icons";
import { FilterSection } from "@/features/search/components/FilterSection";
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectGroup,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from "@/shared/ui/multi-select";
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

interface FilterOption {
  id: string;
  label: string;
}

interface VisualFiltersProps {
  filters: {
    selectedCategories: string[];
    setSelectedCategories: (categories: string[]) => void;
    categoryOptions: FilterOption[];
    selectedLocations: string[];
    setSelectedLocations: (locations: string[]) => void;
    selectedFoods: string[];
    setSelectedFoods: (foods: string[]) => void;
    foodOptions: FilterOption[];
    selectedDays: string[];
    setSelectedDays: (days: string[]) => void;
    dayOptions: FilterOption[];
    priceRange: { min: string; max: string };
    setPriceRange: (range: { min: string; max: string }) => void;
    registration: boolean;
    setRegistration: (value: boolean) => void;
    selectedOrganizations: string[];
    setSelectedOrganizations: (value: string[]) => void;
    availableOrganizations: string[];
  };
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function VisualFilters({ filters, viewMode, onViewModeChange }: VisualFiltersProps) {
  const { t } = useTranslation();

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
          values={filters.selectedCategories}
          onValuesChange={filters.setSelectedCategories}
        >
          <MultiSelectTrigger className="w-full">
            <MultiSelectValue placeholder={t("forms.selectCategories")} />
          </MultiSelectTrigger>
          <MultiSelectContent>
            <MultiSelectGroup>
              {filters.categoryOptions.map((category) => (
                <MultiSelectItem key={category.id} value={category.id}>
                  {category.label}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>
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
          values={filters.selectedFoods}
          onValuesChange={filters.setSelectedFoods}
        >
          <MultiSelectTrigger className="w-full">
            <MultiSelectValue placeholder={t("forms.selectFoods")} />
          </MultiSelectTrigger>
          <MultiSelectContent>
            <MultiSelectGroup>
              {filters.foodOptions.map((food) => (
                <MultiSelectItem key={food.id} value={food.id}>
                  {food.label}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>
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
          values={filters.selectedDays}
          onValuesChange={filters.setSelectedDays}
        >
          <MultiSelectTrigger className="w-full">
            <MultiSelectValue placeholder={t("forms.selectDays")} />
          </MultiSelectTrigger>
          <MultiSelectContent search={false}>
            <MultiSelectGroup>
              {filters.dayOptions.map((day) => (
                <MultiSelectItem key={day.id} value={day.id}>
                  {day.label}
                </MultiSelectItem>
              ))}
            </MultiSelectGroup>
          </MultiSelectContent>
        </MultiSelect>
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
