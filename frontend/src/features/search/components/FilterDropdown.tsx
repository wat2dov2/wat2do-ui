import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { AIGenerationInput } from "@/shared/ui/ai-generation-input";
import { VisualFilters } from "@/features/search/components/VisualFilters";
import { JSONFilterEditor } from "@/features/search/components/JSONFilterEditor";
import { useProfileCompleted } from "@/features/auth";
import type { FilterViewMode, ViewMode } from "@/shared/types";

interface PieMenuItem {
  id: string;
  label: string;
  iconName: string;
}

interface FilterDropdownFilters {
  // AI generation
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  aiGenerating: boolean;
  handleAiGenerate: () => void;
  // JSON editor
  jsonError: string;
  jsonValue: string;
  handleJsonChange: (value: string | undefined) => void;
  // Category filters
  selectedCategories: string[];
  setSelectedCategories: (categories: string[]) => void;
  categoryPieItems: PieMenuItem[];
  toggleCategory: (id: string) => void;
  // Location filters
  selectedLocations: string[];
  setSelectedLocations: (locations: string[]) => void;
  // Food filters
  selectedFoods: string[];
  setSelectedFoods: (foods: string[]) => void;
  foodPieItems: PieMenuItem[];
  toggleFood: (id: string) => void;
  // Day of week filters
  selectedDays: string[];
  setSelectedDays: (days: string[]) => void;
  dayPieItems: PieMenuItem[];
  toggleDay: (id: string) => void;
  // Price & registration
  priceRange: { min: string; max: string };
  setPriceRange: (range: { min: string; max: string }) => void;
  registration: boolean;
  setRegistration: (value: boolean) => void;
  // Sort
  sortBy: string;
  setSortBy: (sortBy: string) => void;
  sortOrder: "asc" | "desc";
  setSortOrder: (order: "asc" | "desc") => void;
  sortPieItems: PieMenuItem[];
  // Organization
  selectedOrganizations: string[];
  setSelectedOrganizations: (value: string[]) => void;
  toggleOrganization: (org: string) => void;
  availableOrganizations: string[];
}

interface FilterDropdownProps {
  filterViewMode: FilterViewMode;
  onFilterViewModeChange: (mode: FilterViewMode) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  filters: FilterDropdownFilters;
  isDarkMode: boolean;
}

export function FilterDropdown({
  filterViewMode,
  onFilterViewModeChange,
  viewMode,
  onViewModeChange,
  filters,
  isDarkMode,
}: FilterDropdownProps) {
  const { t } = useTranslation();
  const profileCompleted = useProfileCompleted();

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-base text-foreground">{t("filters.filtersHeader")}</h2>
        <div className="shrink-0">
          <Tabs
            value={filterViewMode}
            onValueChange={(value) =>
              onFilterViewModeChange(value as FilterViewMode)
            }
            className="w-fit"
          >
            <TabsList variant="default" className="h-8">
              <TabsTrigger
                value="visual"
                className="text-[11px] font-medium px-3 py-1"
              >
                {t("settings.appearance.visual")}
              </TabsTrigger>
              <TabsTrigger
                value="json"
                className="text-[11px] font-medium px-3 py-1"
              >
                {t("settings.appearance.json")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <AIGenerationInput
        aiPrompt={filters.aiPrompt}
        onAiPromptChange={filters.setAiPrompt}
        onAiPromptClear={() => filters.setAiPrompt("")}
        aiGenerating={filters.aiGenerating}
        onAiGenerate={filters.handleAiGenerate}
        error={filters.jsonError}
        title={t("filters.aiFilterGeneration")}
        placeholder={!profileCompleted ? t("filters.aiFilterPlaceholderDisabled") : t("filters.aiFilterPlaceholder")}
        generatingText={t("common.generating")}
        disabled={!profileCompleted}
      />

      {filterViewMode === "visual" ? (
        <VisualFilters
          filters={filters}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
        />
      ) : (
        <JSONFilterEditor
          jsonValue={filters.jsonValue}
          onJsonChange={filters.handleJsonChange}
          isDarkMode={isDarkMode}
        />
      )}
    </>
  );
}
