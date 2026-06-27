import { useState, useEffect, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { SubmittedSearchInput } from "@/shared/ui/submitted-search-input";

interface SearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSearchClear: () => void;
  onSearchKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}

export function SearchBar({
  searchQuery,
  onSearchChange,
  onSearchClear,
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
  );
}
