import React from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Grid3x3, Search, X } from "@/shared/ui/doodle-icons";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import type { ViewMode } from "@/shared/types";

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

  return (
    <div className="flex gap-3 items-stretch">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          data-elevation="control"
          placeholder={t("search.placeholder")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          className="flex h-11 w-full min-w-0 items-center rounded-xl bg-secondary py-2 pl-9 pr-3 text-base text-secondary-foreground shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:h-8 md:text-sm"
        />
        {searchQuery && (
          <button
            onMouseDown={onSearchClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* View Mode Toggle */}
      <div className="shrink-0">
        <Tabs
          value={viewMode}
          onValueChange={(value) => {
            onViewModeChange(value as ViewMode);
          }}
          className="w-fit"
        >
          <TabsList variant="default" className="h-12 md:h-8">
            <Tooltip>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value="grid"
                  className="size-11 px-0 py-0 md:size-7"
                  aria-label={t("settings.appearance.grid")}
                >
                  <Grid3x3 className="size-4" />
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
                  className="size-11 px-0 py-0 md:size-7"
                  aria-label={t("settings.appearance.calendar")}
                >
                  <Calendar className="size-4" />
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
