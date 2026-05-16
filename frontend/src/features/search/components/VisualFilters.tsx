import React, { useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tag, MapPin, Utensils, Calendar, CalendarDays, ArrowUpDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { FilterSection } from "@/features/search/components/FilterSection";
import { translateCategory } from "@/shared/utils/event";
import { PieMenu } from "@/shared/ui/pie-menu";
import { Switch } from "@/shared/ui/switch";
import { usePieMenu } from "@/shared/hooks/usePieMenu";

const PIE_ICON_MAP: Record<string, LucideIcon> = {
  Tag,
  MapPin,
  Utensils,
  Calendar,
  CalendarDays,
  ArrowUpDown,
};

function mapPieItems(items: Array<{ id: string; label: string; iconName: string }>) {
  return items.map((item) => {
    const Icon = PIE_ICON_MAP[item.iconName];
    return { id: item.id, label: item.label, icon: Icon ? <Icon className="size-4" /> : undefined };
  });
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
    requiresRegistration: boolean;
    setRequiresRegistration: (value: boolean) => void;
    sortBy: string;
    setSortBy: (sortBy: string) => void;
    sortOrder: "asc" | "desc";
    setSortOrder: (order: "asc" | "desc") => void;
    sortPieItems: Array<{ id: string; label: string; iconName: string }>;
  };
}

export function VisualFilters({ filters }: VisualFiltersProps) {
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

  // Manage expanded sections state locally (UI state, not business logic)
  const [expandedSections, setExpandedSections] = useState({
    category: true,
    location: false,
    priceRange: false,
    food: false,
    dayOfWeek: false,
    registration: false,
    sort: false,
  });

  const toggleSection = useCallback((section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  return (
    <div className="-space-y-px">
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
            onClick={categoryPieMenu.open}
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
        <input
          type="text"
          placeholder={t("forms.locationPlaceholder")}
          value={filters.selectedLocations[0] ?? ""}
          onChange={(e) =>
            filters.setSelectedLocations(
              e.target.value.trim() ? [e.target.value.trim()] : [],
            )
          }
          className="bg-secondary text-foreground text-xs px-3 py-2.5 rounded-xl w-full focus:outline-none focus:ring-2 focus:ring-primary border border-border placeholder:text-muted-foreground"
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
            onClick={foodPieMenu.open}
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
            onClick={dayPieMenu.open}
            className="bg-secondary font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-muted/60 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.selectedDays.length > 0
                ? filters.selectedDays
                    .map((day) => t(`days.${day.toLowerCase()}`) || day)
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
        title={t("filters.requiresRegistration")}
        expanded={expandedSections.registration}
        onToggle={() => toggleSection("registration")}
        indicator={filters.requiresRegistration ? "1" : undefined}
        onClear={() => filters.setRequiresRegistration(false)}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-foreground">
            {t("filters.requiresRegistration")}
          </span>
          <Switch
            checked={filters.requiresRegistration}
            onCheckedChange={(checked) =>
              filters.setRequiresRegistration(!!checked)
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
              onClick={sortPieMenu.open}
              className="bg-secondary font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-muted/60 transition-colors flex items-center justify-between cursor-pointer"
            >
              <span>
                {t(`filters.${filters.sortBy}`)} (
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
              onClick={() =>
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
