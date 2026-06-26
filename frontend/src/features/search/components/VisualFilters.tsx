import { useState, useCallback, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Tag, MapPin, Utensils, Calendar, CalendarDays, ArrowUpDown, Sparkles, Grid3x3 } from "@/shared/ui/doodle-icons";
import type { LucideIcon } from "@/shared/ui/doodle-icons";
import { FilterSection } from "@/features/search/components/FilterSection";
import { translateCategory } from "@/shared/utils/event";
import { PieMenu } from "@/shared/ui/pie-menu";
import { Switch } from "@/shared/ui/switch";
import { usePieMenu } from "@/shared/hooks/usePieMenu";
import { SearchCombobox } from "@/shared/ui/search-combobox";
import type { ViewMode } from "@/shared/types";

const PIE_ICON_MAP: Record<string, LucideIcon> = {
  Tag,
  MapPin,
  Utensils,
  Calendar,
  CalendarDays,
  ArrowUpDown,
  Sparkles,
};

function mapPieItems(items: Array<{ id: string; label: string; iconName: string }>) {
  return items.map((item) => {
    const Icon = PIE_ICON_MAP[item.iconName];
    return { id: item.id, label: item.label, icon: Icon ? <Icon className="size-4" /> : undefined };
  });
}

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
    <input
      type="text"
      placeholder={placeholder}
      value={localValue}
      onChange={handleChange}
      className="bg-secondary text-foreground text-xs px-3 py-2.5 rounded-xl w-full focus:outline-none focus:ring-2 focus:ring-primary border border-border placeholder:text-muted-foreground"
    />
  );
}

interface VisualFiltersProps {
  filters: {
    selectedCategories: string[];
    setSelectedCategories: (categories: string[]) => void;
    categoryPieItems: Array<{ id: string; label: string; iconName: string }>;
    toggleCategory: (id: string) => void;
    selectedLocations: string[];
    setSelectedLocations: (locations: string[]) => void;
    selectedFoods: string[];
    setSelectedFoods: (foods: string[]) => void;
    foodPieItems: Array<{ id: string; label: string; iconName: string }>;
    toggleFood: (id: string) => void;
    selectedDays: string[];
    setSelectedDays: (days: string[]) => void;
    dayPieItems: Array<{ id: string; label: string; iconName: string }>;
    toggleDay: (id: string) => void;
    priceRange: { min: string; max: string };
    setPriceRange: (range: { min: string; max: string }) => void;
    registration: boolean;
    setRegistration: (value: boolean) => void;
    sortBy: string;
    setSortBy: (sortBy: string) => void;
    sortOrder: "asc" | "desc";
    setSortOrder: (order: "asc" | "desc") => void;
    sortPieItems: Array<{ id: string; label: string; iconName: string }>;
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

  // Pie-menu UI state lives here, alongside the components that render the menus.
  const categoryPieMenu = usePieMenu();
  const foodPieMenu = usePieMenu();
  const dayPieMenu = usePieMenu();
  const sortPieMenu = usePieMenu();

  // Map icon-name data into JSX for PieMenu rendering
  const categoryPieItemsWithIcons = useMemo(
    () => mapPieItems(filters.categoryPieItems),
    [filters.categoryPieItems],
  );
  const foodPieItemsWithIcons = useMemo(
    () => mapPieItems(filters.foodPieItems),
    [filters.foodPieItems],
  );
  const dayPieItemsWithIcons = useMemo(
    () => mapPieItems(filters.dayPieItems),
    [filters.dayPieItems],
  );
  const sortPieItemsWithIcons = useMemo(
    () => mapPieItems(filters.sortPieItems),
    [filters.sortPieItems],
  );
  const selectedSortLabel = useMemo(
    () =>
      filters.sortPieItems.find((item) => item.id === filters.sortBy)?.label ??
      t(`filters.${filters.sortBy}`),
    [filters.sortBy, filters.sortPieItems, t],
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

  // Manage expanded sections state locally (UI state, not business logic)
  const [expandedSections, setExpandedSections] = useState({
    viewMode: false,
    category: true,
    location: false,
    priceRange: false,
    food: false,
    dayOfWeek: false,
    registration: false,
    sort: false,
    organization: false,
  });

  const toggleSection = useCallback((section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  return (
    <div className="-space-y-px">
      {/* View Mode */}
      <FilterSection
        title={t("common.view")}
        expanded={expandedSections.viewMode}
        onToggle={() => toggleSection("viewMode")}
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
              <button
                key={option.id}
                type="button"
                onMouseDown={() => onViewModeChange(option.id)}
                className={`flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary/80 text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <ViewIcon className="size-3.5" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </FilterSection>

      {/* Category Filter */}
      <FilterSection
        title={t("filters.category")}
        expanded={expandedSections.category}
        onToggle={() => toggleSection("category")}
        indicator={
          filters.selectedCategories.length > 0
            ? `${filters.selectedCategories.length}`
            : undefined
        }
        onClear={() => filters.setSelectedCategories([])}
      >
        <div className="relative">
          <button
            onMouseDown={categoryPieMenu.open}
            className="bg-secondary font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-muted/60 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.selectedCategories.length > 0
                ? filters.selectedCategories
                    .map((cat) => translateCategory(cat, t))
                    .join(", ")
                : t("forms.selectCategories")}
            </span>
            <Tag className="size-4 text-muted-foreground" />
          </button>
          <PieMenu
            items={categoryPieItemsWithIcons}
            isOpen={categoryPieMenu.isOpen}
            position={categoryPieMenu.position}
            onClose={categoryPieMenu.close}
            onSelect={(item) => filters.toggleCategory(item.id)}
            selectedIds={filters.selectedCategories}
            closeOnSelect={false}
            radius={140}
            innerRadius={20}
          />
        </div>
      </FilterSection>

      {/* Location Filter (free-text: filter events by location substring) */}
      <FilterSection
        title={t("filters.location")}
        expanded={expandedSections.location}
        onToggle={() => toggleSection("location")}
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
        expanded={expandedSections.food}
        onToggle={() => toggleSection("food")}
        indicator={
          filters.selectedFoods.length > 0
            ? `${filters.selectedFoods.length}`
            : undefined
        }
        onClear={() => filters.setSelectedFoods([])}
      >
        <div className="relative">
          <button
            onMouseDown={foodPieMenu.open}
            className="bg-secondary font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-muted/60 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.selectedFoods.length > 0
                ? filters.selectedFoods
                    .map((food) => {
                      const translation = t(`foods.${food}`);
                      return translation.startsWith("foods.") ? food : translation;
                    })
                    .join(", ")
                : t("forms.selectFoods")}
            </span>
            <Utensils className="size-4 text-muted-foreground" />
          </button>
          <PieMenu
            items={foodPieItemsWithIcons}
            isOpen={foodPieMenu.isOpen}
            position={foodPieMenu.position}
            onClose={foodPieMenu.close}
            onSelect={(item) => filters.toggleFood(item.id)}
            selectedIds={filters.selectedFoods}
            closeOnSelect={false}
            radius={140}
            innerRadius={20}
          />
        </div>
      </FilterSection>

      {/* Day of Week Filter */}
      <FilterSection
        title={t("filters.dayOfWeek")}
        expanded={expandedSections.dayOfWeek}
        onToggle={() => toggleSection("dayOfWeek")}
        indicator={
          filters.selectedDays.length > 0
            ? `${filters.selectedDays.length}`
            : undefined
        }
        onClear={() => filters.setSelectedDays([])}
      >
        <div className="relative">
          <button
            onMouseDown={dayPieMenu.open}
            className="bg-secondary font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-muted/60 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.selectedDays.length > 0
                ? filters.selectedDays
                    .map((day) => {
                      const key = `days.${day.toLowerCase()}`;
                      const translated = t(key);
                      return translated !== key ? translated : day;
                    })
                    .join(", ")
                : t("forms.selectDays")}
            </span>
            <CalendarDays className="size-4 text-muted-foreground" />
          </button>
          <PieMenu
            items={dayPieItemsWithIcons}
            isOpen={dayPieMenu.isOpen}
            position={dayPieMenu.position}
            onClose={dayPieMenu.close}
            onSelect={(item) => filters.toggleDay(item.id)}
            selectedIds={filters.selectedDays}
            closeOnSelect={false}
            radius={140}
            innerRadius={20}
          />
        </div>
      </FilterSection>

      {/* Organization Filter */}
      <FilterSection
        title={t("filters.organization", "Organization")}
        expanded={expandedSections.organization}
        onToggle={() => toggleSection("organization")}
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
        expanded={expandedSections.priceRange}
        onToggle={() => toggleSection("priceRange")}
        indicator={
          filters.priceRange.min || filters.priceRange.max ? "1" : undefined
        }
        onClear={() => filters.setPriceRange({ min: "", max: "" })}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number"
              placeholder={t("filters.minPrice")}
              value={filters.priceRange.min}
              onChange={(e) =>
                filters.setPriceRange({
                  ...filters.priceRange,
                  min: e.target.value,
                })
              }
              className="bg-secondary text-foreground text-xs px-3 py-2 rounded-xl w-full focus:outline-none focus:ring-2 focus:ring-primary border border-border"
            />
            <span className="text-muted-foreground text-xs">-</span>
            <input
              type="number"
              placeholder={t("filters.maxPrice")}
              value={filters.priceRange.max}
              onChange={(e) =>
                filters.setPriceRange({
                  ...filters.priceRange,
                  max: e.target.value,
                })
              }
              className="bg-secondary text-foreground text-xs px-3 py-2 rounded-xl w-full focus:outline-none focus:ring-2 focus:ring-primary border border-border"
            />
          </div>
        </div>
      </FilterSection>

      {/* Requires Registration Filter */}
      <FilterSection
        title={t("filters.registration")}
        expanded={expandedSections.registration}
        onToggle={() => toggleSection("registration")}
        indicator={filters.registration ? "1" : undefined}
        onClear={() => filters.setRegistration(false)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-foreground">
            {t("filters.registration")}
          </span>
          <Switch
            checked={filters.registration}
            onCheckedChange={(checked) =>
              filters.setRegistration(!!checked)
            }
          />
        </div>
      </FilterSection>

      {/* Sort Filter */}
      <FilterSection
        title={t("filters.sort")}
        expanded={expandedSections.sort}
        onToggle={() => toggleSection("sort")}
      >
        <div className="space-y-2">
          <div className="relative">
            <button
              onMouseDown={sortPieMenu.open}
              className="bg-secondary font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-muted/60 transition-colors flex items-center justify-between cursor-pointer"
            >
              <span>
                {selectedSortLabel} (
                {filters.sortOrder === "asc" ? t("filters.asc") : t("filters.desc")})
              </span>
              <ArrowUpDown className="size-4 text-muted-foreground" />
            </button>
            <PieMenu
              items={sortPieItemsWithIcons}
              isOpen={sortPieMenu.isOpen}
              position={sortPieMenu.position}
              onClose={sortPieMenu.close}
              onSelect={(item) => {
                filters.setSortBy(item.id);
                sortPieMenu.close();
              }}
              selectedIds={[filters.sortBy]}
              closeOnSelect={true}
              radius={140}
              innerRadius={20}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onMouseDown={() =>
                filters.setSortOrder(
                  filters.sortOrder === "asc" ? "desc" : "asc",
                )
              }
              className="bg-secondary text-foreground text-xs px-3 py-1.5 rounded-xl hover:bg-muted/60 transition-colors flex items-center gap-1.5"
            >
              <ArrowUpDown className="size-3.5" />
              <span>
                {filters.sortOrder === "asc"
                  ? t("filters.ascending")
                  : t("filters.descending")}
              </span>
            </button>
          </div>
        </div>
      </FilterSection>
    </div>
  );
}
