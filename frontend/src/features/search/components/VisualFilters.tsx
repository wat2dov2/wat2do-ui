import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FilterSection } from "@/features/search/components/FilterSection";
import { MultiSelect } from "@/shared/ui/multi-select";
import { Switch } from "@/shared/ui/switch";
import { Input } from "@/shared/ui/input";
import { FormGrid } from "@/shared/layout";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

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
  selectedClubs: string[];
  setSelectedClubs: (value: string[]) => void;
}

interface VisualFiltersProps {
  school: string;
  filters: VisualFilterControls;
}

export function VisualFilters({ school, filters }: VisualFiltersProps) {
  const { t } = useTranslation();
  const { schoolBySlug } = useSchoolDirectory();
  const locationPlaceholder = schoolBySlug.get(school)?.location_examples?.join(", ") || t("filters.location");

  const dayValues = useMemo(
    () => filters.dayOptions.map((o) => o.id),
    [filters.dayOptions],
  );
  const dayLabels = useMemo(
    () => new Map(filters.dayOptions.map((o) => [o.id, o.label])),
    [filters.dayOptions],
  );

  const activePriceFilterCount =
    Number(Boolean(filters.minPrice)) + Number(Boolean(filters.maxPrice));

  return (
    <div className="-space-y-px">
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
          placeholder={locationPlaceholder}
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

      {/* Club Filter */}
      <FilterSection
        title={t("filters.club", "Club")}
        indicator={
          filters.selectedClubs[0]?.trim()
            ? "1"
            : undefined
        }
        onClear={() => filters.setSelectedClubs([])}
      >
        <SingleValueFilterInput
          value={filters.selectedClubs[0] ?? ""}
          onChange={filters.setSelectedClubs}
          placeholder={t("filters.searchClub")}
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
