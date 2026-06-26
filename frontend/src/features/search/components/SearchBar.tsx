import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
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
    { value: "upcoming" as const, label: t("events.upcoming") },
    { value: "today" as const, label: t("events.dateSections.today") },
    { value: "tomorrow" as const, label: t("events.dateSections.tomorrow") },
    { value: "weekend" as const, label: t("events.weekend") },
  ];

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
      <div className="flex shrink-0 self-stretch">
        <Select
          value={datePreset}
          onValueChange={(value) => onDatePresetChange(value as DatePreset)}
        >
          <SelectTrigger className="h-full min-w-[7.5rem] data-[size=default]:h-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {datePresetOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
