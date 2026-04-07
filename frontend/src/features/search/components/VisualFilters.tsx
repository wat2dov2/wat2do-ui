import React, { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Tag, MapPin, Utensils, CalendarDays, ArrowUpDown } from "lucide-react";
import { FilterSection } from "@/features/search/components/FilterSection";
import { translateCategory } from "@/shared/utils/event";
import { DatePicker } from "@/features/search/components/DatePicker";
import { PieMenu } from "@/shared/ui/pie-menu";
import { Switch } from "@/shared/ui/switch";

interface VisualFiltersProps {
  filters: {
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
    addedSince: Date | undefined;
    setAddedSince: (date: Date | undefined) => void;
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
  
  // Manage expanded sections state locally (UI state, not business logic)
  const [expandedSections, setExpandedSections] = useState({
    category: true,
    dateRange: false,
    location: false,
    priceRange: false,
    food: false,
    dayOfWeek: false,
    addedSince: false,
    registration: false,
    sort: false,
  });

  const toggleSection = useCallback((section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);
  
  // Manage popup states locally (UI state)
  const [showDateRangePicker, setShowDateRangePicker] = useState(false);
  const [showAddedSincePicker, setShowAddedSincePicker] = useState(false);

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
            onClick={filters.categoryPieMenu.open}
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-accent/60 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.selectedCategories.length > 0
                ? filters.selectedCategories
                    .map((cat) => translateCategory(cat, t))
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
              e.target.value.trim() ? [e.target.value.trim()] : []
            )
          }
          className="bg-muted text-foreground text-xs px-3 py-2.5 rounded-xl w-full focus:outline-none focus:ring-2 focus:ring-primary border border-border placeholder:text-muted-foreground"
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
            onClick={filters.foodPieMenu.open}
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-accent/60 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.selectedFoods.length > 0
                ? filters.selectedFoods
                    .map((food) => {
                      const translation = t(`foods.${food}`);
                      // If translation returns the key itself (missing translation), use the food value
                      return translation.startsWith("foods.") ? food : translation;
                    })
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
            onClick={filters.dayPieMenu.open}
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-accent/60 transition-colors flex items-center justify-between cursor-pointer"
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
        expanded={expandedSections.dateRange}
        onToggle={() => toggleSection("dateRange")}
        indicator={filters.dateRange ? "1" : undefined}
        onClear={() => filters.setDateRange(undefined)}
      >
        <div className="relative" data-calendar-picker>
          <button
            data-calendar-trigger
            onClick={() => setShowDateRangePicker(!showDateRangePicker)}
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-accent/60 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.dateRange
                ? filters.dateRange.toLocaleDateString()
                : t("forms.selectDate")}
            </span>
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
          </button>
          {showDateRangePicker && (
            <div className="absolute z-dropdown mt-1">
              <DatePicker
                selected={filters.dateRange}
                onSelect={(date) => {
                  filters.setDateRange(date);
                  setShowDateRangePicker(false);
                }}
                onClose={() => setShowDateRangePicker(false)}
              />
            </div>
          )}
        </div>
      </FilterSection>

      {/* Added Since Filter */}
      <FilterSection
        title={t("filters.addedSince")}
        expanded={expandedSections.addedSince}
        onToggle={() => toggleSection("addedSince")}
        indicator={filters.addedSince ? "1" : undefined}
        onClear={() => filters.setAddedSince(undefined)}
      >
        <div className="relative" data-calendar-picker>
          <button
            data-calendar-trigger
            onClick={() => setShowAddedSincePicker(!showAddedSincePicker)}
            className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-accent/60 transition-colors flex items-center justify-between cursor-pointer"
          >
            <span>
              {filters.addedSince
                ? filters.addedSince.toLocaleDateString()
                : t("forms.selectDate")}
            </span>
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
          </button>
          {showAddedSincePicker && (
            <div className="absolute z-dropdown mt-1">
              <DatePicker
                selected={filters.addedSince}
                onSelect={(date) => {
                  filters.setAddedSince(date);
                  setShowAddedSincePicker(false);
                }}
                onClose={() => setShowAddedSincePicker(false)}
              />
            </div>
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
              onClick={filters.sortPieMenu.open}
              className="bg-muted font-medium text-foreground text-xs px-3 py-2.5 rounded-xl w-full text-left hover:bg-accent/60 transition-colors flex items-center justify-between cursor-pointer"
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
              className="bg-muted text-foreground text-xs px-3 py-1.5 rounded-xl hover:bg-accent/60 transition-colors flex items-center gap-1.5"
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
