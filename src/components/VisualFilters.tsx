import React from "react";
import { useTranslation } from "react-i18next";
import { Tag, MapPin, Utensils, CalendarDays, ArrowUpDown } from "lucide-react";
import { FilterSection } from "@/components/FilterSection";
import { DatePicker } from "@/components/DatePicker";
import { PieMenu } from "@/components/ui/pie-menu";

interface VisualFiltersProps {
  filters: {
    expandedSections: {
      category: boolean;
      location: boolean;
      food: boolean;
      dayOfWeek: boolean;
      dateRange: boolean;
      addedSince: boolean;
      priceRange: boolean;
      registration: boolean;
      sort: boolean;
    };
    toggleSection: (section: string) => void;
    selectedCategories: string[];
    setSelectedCategories: (categories: string[]) => void;
    categoryPieMenu: {
      isOpen: boolean;
      position: { x: number; y: number } | null;
      open: (e: React.MouseEvent) => void;
      close: () => void;
    };
    categoryPieItems: Array<{ id: string; label: string; icon: React.ReactNode }>;
    toggleCategory: (id: string) => void;
    selectedLocations: string[];
    setSelectedLocations: (locations: string[]) => void;
    locationPieMenu: {
      isOpen: boolean;
      position: { x: number; y: number } | null;
      open: (e: React.MouseEvent) => void;
      close: () => void;
    };
    locationPieItems: Array<{ id: string; label: string; icon: React.ReactNode }>;
    toggleLocation: (id: string) => void;
    selectedFoods: string[];
    setSelectedFoods: (foods: string[]) => void;
    foodPieMenu: {
      isOpen: boolean;
      position: { x: number; y: number } | null;
      open: (e: React.MouseEvent) => void;
      close: () => void;
    };
    foodPieItems: Array<{ id: string; label: string; icon: React.ReactNode }>;
    toggleFood: (id: string) => void;
    selectedDays: string[];
    setSelectedDays: (days: string[]) => void;
    dayPieMenu: {
      isOpen: boolean;
      position: { x: number; y: number } | null;
      open: (e: React.MouseEvent) => void;
      close: () => void;
    };
    dayPieItems: Array<{ id: string; label: string; icon: React.ReactNode }>;
    toggleDay: (id: string) => void;
    dateRange: Date | undefined;
    setDateRange: (date: Date | undefined) => void;
    showDateRangePicker: boolean;
    setShowDateRangePicker: (show: boolean) => void;
    addedSince: Date | undefined;
    setAddedSince: (date: Date | undefined) => void;
    showAddedSincePicker: boolean;
    setShowAddedSincePicker: (show: boolean) => void;
    priceRange: { min: string; max: string };
    setPriceRange: (range: { min: string; max: string }) => void;
    requiresRegistration: boolean;
    setRequiresRegistration: (value: boolean) => void;
    sortBy: string;
    setSortBy: (sortBy: string) => void;
    sortOrder: "asc" | "desc";
    setSortOrder: (order: "asc" | "desc") => void;
    sortPieMenu: {
      isOpen: boolean;
      position: { x: number; y: number } | null;
      open: (e: React.MouseEvent) => void;
      close: () => void;
    };
    sortPieItems: Array<{ id: string; label: string; icon: React.ReactNode }>;
  };
}

export function VisualFilters({ filters }: VisualFiltersProps) {
  const { t } = useTranslation();

  return (
    <div className="-space-y-px">
      {/* Category Filter */}
      <FilterSection
        title={t("filters.category")}
        expanded={filters.expandedSections.category}
        onToggle={() => filters.toggleSection("category")}
        indicator={
          filters.selectedCategories.length > 0
            ? `${filters.selectedCategories.length}`
            : undefined
        }
        onClear={() => filters.setSelectedCategories([])}
      >
        <div className="relative">
          <button
            onClick={filters.categoryPieMenu.open}
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.selectedCategories.length > 0
                ? filters.selectedCategories
                    .map((cat) => t(`categories.${cat}`) || cat)
                    .join(", ")
                : t("forms.selectCategories")}
            </span>
            <Tag className="w-4 h-4 text-muted-foreground" />
          </button>
          <PieMenu
            items={filters.categoryPieItems}
            isOpen={filters.categoryPieMenu.isOpen}
            position={filters.categoryPieMenu.position}
            onClose={filters.categoryPieMenu.close}
            onSelect={(item) => filters.toggleCategory(item.id)}
            selectedIds={filters.selectedCategories}
            closeOnSelect={false}
            radius={140}
            innerRadius={20}
          />
        </div>
      </FilterSection>

      {/* Food Filter */}
      <FilterSection
        title={t("filters.food")}
        expanded={filters.expandedSections.food}
        onToggle={() => filters.toggleSection("food")}
        indicator={
          filters.selectedFoods.length > 0
            ? `${filters.selectedFoods.length}`
            : undefined
        }
        onClear={() => filters.setSelectedFoods([])}
      >
        <div className="relative">
          <button
            onClick={filters.foodPieMenu.open}
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.selectedFoods.length > 0
                ? filters.selectedFoods
                    .map((food) => t(`foods.${food}`) || food)
                    .join(", ")
                : t("forms.selectFoods")}
            </span>
            <Utensils className="w-4 h-4 text-muted-foreground" />
          </button>
          <PieMenu
            items={filters.foodPieItems}
            isOpen={filters.foodPieMenu.isOpen}
            position={filters.foodPieMenu.position}
            onClose={filters.foodPieMenu.close}
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
        expanded={filters.expandedSections.dayOfWeek}
        onToggle={() => filters.toggleSection("dayOfWeek")}
        indicator={
          filters.selectedDays.length > 0
            ? `${filters.selectedDays.length}`
            : undefined
        }
        onClear={() => filters.setSelectedDays([])}
      >
        <div className="relative">
          <button
            onClick={filters.dayPieMenu.open}
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.selectedDays.length > 0
                ? filters.selectedDays
                    .map((day) => t(`days.${day.toLowerCase()}`) || day)
                    .join(", ")
                : t("forms.selectDays")}
            </span>
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
          </button>
          <PieMenu
            items={filters.dayPieItems}
            isOpen={filters.dayPieMenu.isOpen}
            position={filters.dayPieMenu.position}
            onClose={filters.dayPieMenu.close}
            onSelect={(item) => filters.toggleDay(item.id)}
            selectedIds={filters.selectedDays}
            closeOnSelect={false}
            radius={140}
            innerRadius={20}
          />
        </div>
      </FilterSection>

      {/* Date Range Filter */}
      <FilterSection
        title={t("filters.dateRange")}
        expanded={filters.expandedSections.dateRange}
        onToggle={() => filters.toggleSection("dateRange")}
        indicator={filters.dateRange ? "1" : undefined}
        onClear={() => filters.setDateRange(undefined)}
      >
        <div className="relative" data-calendar-picker>
          <button
            data-calendar-trigger
            onClick={() =>
              filters.setShowDateRangePicker(!filters.showDateRangePicker)
            }
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.dateRange
                ? filters.dateRange.toLocaleDateString()
                : t("forms.selectDate")}
            </span>
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
          </button>
          {filters.showDateRangePicker && (
            <div className="absolute z-50 mt-1">
              <DatePicker
                selected={filters.dateRange}
                onSelect={(date) => {
                  filters.setDateRange(date);
                  filters.setShowDateRangePicker(false);
                }}
                onClose={() => filters.setShowDateRangePicker(false)}
              />
            </div>
          )}
        </div>
      </FilterSection>

      {/* Added Since Filter */}
      <FilterSection
        title={t("filters.addedSince")}
        expanded={filters.expandedSections.addedSince}
        onToggle={() => filters.toggleSection("addedSince")}
        indicator={filters.addedSince ? "1" : undefined}
        onClear={() => filters.setAddedSince(undefined)}
      >
        <div className="relative" data-calendar-picker>
          <button
            data-calendar-trigger
            onClick={() =>
              filters.setShowAddedSincePicker(!filters.showAddedSincePicker)
            }
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.addedSince
                ? filters.addedSince.toLocaleDateString()
                : t("forms.selectDate")}
            </span>
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
          </button>
          {filters.showAddedSincePicker && (
            <div className="absolute z-50 mt-1">
              <DatePicker
                selected={filters.addedSince}
                onSelect={(date) => {
                  filters.setAddedSince(date);
                  filters.setShowAddedSincePicker(false);
                }}
                onClose={() => filters.setShowAddedSincePicker(false)}
              />
            </div>
          )}
        </div>
      </FilterSection>

      {/* Price Range Filter */}
      <FilterSection
        title={t("filters.priceRange")}
        expanded={filters.expandedSections.priceRange}
        onToggle={() => filters.toggleSection("priceRange")}
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
              className="bg-muted text-foreground text-xs px-3 py-2 rounded-xl w-full focus:outline-none focus:ring-2 focus:ring-primary border border-border"
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
              className="bg-muted text-foreground text-xs px-3 py-2 rounded-xl w-full focus:outline-none focus:ring-2 focus:ring-primary border border-border"
            />
          </div>
        </div>
      </FilterSection>

      {/* Requires Registration Filter */}
      <FilterSection
        title={t("filters.requiresRegistration")}
        expanded={filters.expandedSections.registration}
        onToggle={() => filters.toggleSection("registration")}
        indicator={filters.requiresRegistration ? "1" : undefined}
        onClear={() => filters.setRequiresRegistration(false)}
      >
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.requiresRegistration}
            onChange={(e) => filters.setRequiresRegistration(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-primary focus:ring-primary"
          />
          <span className="text-xs text-foreground">
            {t("filters.onlyShowEventsRequiringRegistration")}
          </span>
        </label>
      </FilterSection>

      {/* Sort Filter */}
      <FilterSection
        title={t("filters.sort")}
        expanded={filters.expandedSections.sort}
        onToggle={() => filters.toggleSection("sort")}
      >
        <div className="space-y-2">
          <div className="relative">
            <button
              onClick={filters.sortPieMenu.open}
              className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-gray-200 transition-colors flex items-center justify-between cursor-pointer"
            >
              <span>
                {t(`filters.${filters.sortBy}`)} (
                {filters.sortOrder === "asc" ? t("filters.asc") : t("filters.desc")})
              </span>
              <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
            </button>
            <PieMenu
              items={filters.sortPieItems}
              isOpen={filters.sortPieMenu.isOpen}
              position={filters.sortPieMenu.position}
              onClose={filters.sortPieMenu.close}
              onSelect={(item) => {
                filters.setSortBy(item.id);
                filters.sortPieMenu.close();
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
                  filters.sortOrder === "asc" ? "desc" : "asc"
                )
              }
              className="bg-muted text-foreground text-xs px-3 py-1.5 rounded-xl hover:bg-gray-200 transition-colors flex items-center gap-1.5"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
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
