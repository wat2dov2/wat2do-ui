import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Grid3x3 } from "@/shared/ui/doodle-icons";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import type { ViewMode } from "@/shared/types";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchClear: () => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  onSearchClear,
  viewMode,
  onViewModeChange,
  onSearchKeyDown,
}: SearchBarProps) {
  const { t } = useTranslation();
  const [localQuery, setLocalQuery] = useState(searchQuery);

  // Sync local state when external searchQuery prop changes
  useEffect(() => {
    setLocalQuery(searchQuery);
  }, [searchQuery]);

  const handleClear = () => {
    setLocalQuery("");
    onSearchClear();
  };

  const handleSubmit = () => {
    onSearchChange(localQuery.trim());
  };

  return (
    <div className="flex gap-3 items-stretch">
      <SubmittedSearchInput
        value={localQuery}
        onChange={setLocalQuery}
        onSubmit={handleSubmit}
        onClear={handleClear}
        placeholder={t("search.placeholder")}
        submitLabel={t("common.search")}
        clearLabel={t("search.clear")}
        onKeyDown={onSearchKeyDown}
      />

      {/* View Mode Toggle */}
      <div className="shrink-0">
        <Tabs
          value={viewMode}
          onValueChange={(value) => {
            onViewModeChange(value as ViewMode);
          }}
          className="w-fit"
        >
          <TabsList variant="default" className="h-10">
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value="grid"
                  className="size-9 px-0 py-0"
                  aria-label={t("settings.appearance.grid")}
                >
                  <Grid3x3 className="size-5" />
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("settings.appearance.grid")}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value="calendar"
                  className="size-9 px-0 py-0"
                  aria-label={t("settings.appearance.calendar")}
                >
                  <Calendar className="size-5" />
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("settings.appearance.calendar")}</p>
              </TooltipContent>
            </Tooltip>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
