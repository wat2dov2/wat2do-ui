import React from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { AIGenerationInput } from "@/features/search/components/AIGenerationInput";
import { VisualFilters } from "@/features/search/components/VisualFilters";
import { JSONFilterEditor } from "@/features/search/components/JSONFilterEditor";
import type { FilterViewMode } from "@/shared/types";

interface FilterDropdownProps {
  filterViewMode: FilterViewMode;
  onFilterViewModeChange: (mode: FilterViewMode) => void;
  filters: any; // Type from useAppFilters
  isDarkMode: boolean;
}

export function FilterDropdown({
  filterViewMode,
  onFilterViewModeChange,
  filters,
  isDarkMode,
}: FilterDropdownProps) {
  const { t } = useTranslation();

  return (
    <div
      data-filter-dropdown
      className="rounded-xl overflow-y-auto absolute right-0 top-full mt-2 z-50 px-4 py-4 max-h-[calc(100vh-200px)] bg-card border border-border"
      style={{ width: "300px" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-base text-foreground">{t("filters.filtersHeader")}</h2>
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

      {/* AI Generation Input */}
      <AIGenerationInput
        aiPrompt={filters.aiPrompt}
        onAiPromptChange={filters.setAiPrompt}
        onAiPromptClear={() => filters.setAiPrompt("")}
        aiGenerating={filters.aiGenerating}
        onAiGenerate={filters.handleAiGenerate}
        error={filters.jsonError}
        title={t("filters.aiFilterGeneration")}
        placeholder={t("filters.aiFilterPlaceholder")}
        generatingText={t("common.generating")}
      />

      {/* Filter Content */}
      {filterViewMode === "visual" ? (
        <VisualFilters filters={filters} />
      ) : (
        <JSONFilterEditor
          jsonValue={filters.jsonValue}
          onJsonChange={filters.handleJsonChange}
          isDarkMode={isDarkMode}
        />
      )}
    </div>
  );
}
