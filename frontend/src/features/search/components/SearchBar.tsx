import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, CalendarDays, Clock, Sun } from "@/shared/ui/doodle-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import type { DatePreset } from "@/shared/types";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchClear: () => void;
  datePreset: DatePreset;
  onDatePresetChange: (preset: DatePreset) => void;
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  onSearchClear,
  datePreset,
  onDatePresetChange,
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

  const datePresetOptions = [
    { value: "upcoming" as const, label: t("events.upcoming"), icon: CalendarDays },
    { value: "today" as const, label: t("events.dateSections.today"), icon: Calendar },
    { value: "tomorrow" as const, label: t("events.dateSections.tomorrow"), icon: Clock },
    { value: "weekend" as const, label: t("events.weekend"), icon: Sun },
  ];
  const activeDatePreset = datePresetOptions.find((option) => option.value === datePreset) ?? datePresetOptions[0]!;
  const ActiveDateIcon = activeDatePreset.icon;

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

      {/* Date preset dropdown */}
      <div className="shrink-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-elevation="control"
              className="flex size-11 items-center justify-center rounded-xl bg-transparent text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label={activeDatePreset.label}
              title={activeDatePreset.label}
            >
              <ActiveDateIcon className="size-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {datePresetOptions.map((option) => {
              const PresetIcon = option.icon;

              return (
                <DropdownMenuItem
                  key={option.value}
                  onSelect={() => onDatePresetChange(option.value)}
                >
                  <PresetIcon className="size-3.5" />
                  {option.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
