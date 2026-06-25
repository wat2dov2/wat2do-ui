import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Grid3x3 } from "@/shared/ui/doodle-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
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

  const ActiveViewIcon = viewMode === "calendar" ? Calendar : Grid3x3;
  const activeViewLabel =
    viewMode === "calendar"
      ? t("settings.appearance.calendar")
      : t("settings.appearance.grid");

  return (
    <div className="flex items-stretch gap-3">
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

      {/* View Mode Dropdown */}
      <div className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-elevation="control"
              className="flex size-11 items-center justify-center rounded-xl bg-transparent text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label={activeViewLabel}
              title={activeViewLabel}
            >
              <ActiveViewIcon className="size-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={() => onViewModeChange("grid")}>
              <Grid3x3 className="size-3.5" />
              {t("settings.appearance.grid")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onViewModeChange("calendar")}>
              <Calendar className="size-3.5" />
              {t("settings.appearance.calendar")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
