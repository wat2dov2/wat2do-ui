import React from "react";
import { useTranslation } from "react-i18next";
import { Search, X, Grid3x3, Calendar } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ViewMode } from "@/types";

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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder={t("search.placeholder")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          className="w-full bg-muted text-foreground rounded-xl pl-9 pr-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 transition-all shadow-md"
        />
        {searchQuery && (
          <button
            onClick={onSearchClear}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* View Mode Toggle */}
      <div className="shrink-0">
        <Tabs
          value={viewMode}
          onValueChange={(value) => onViewModeChange(value as ViewMode)}
          className="w-fit"
        >
          <TabsList variant="default" className="h-8">
            <TabsTrigger
              value="grid"
              className="text-[11px] font-medium px-3 py-1"
            >
              <span className="flex items-center gap-1.5">
                <Grid3x3 className="w-3 h-3" strokeWidth={2} />
                <span>{t("settings.appearance.grid")}</span>
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="calendar"
              className="text-[11px] font-medium px-3 py-1"
            >
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3" strokeWidth={2} />
                <span>{t("settings.appearance.calendar")}</span>
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </div>
  );
}
