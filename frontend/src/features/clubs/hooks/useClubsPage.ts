/**
 * Clubs Page Hook
 * Manages data loading and filtering for ClubsPage
 */

import { useState, useMemo, useCallback } from "react";
import type { Club } from "@/shared/types";
import {
  loadClubsData,
  filterClubs,
} from "@/features/clubs/api/clubs.api";
import { useBackendQuery } from "@/shared/hooks/useBackendQuery";
import { useEventsStore } from "@/features/events/store/events.store";

const EMPTY_DATA: { clubs: Club[]; categories: string[] } = { clubs: [], categories: [] };

export function useClubsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const schoolFilter = useEventsStore((s) => s.schoolFilter);

  const fetchClubs = useCallback(() => loadClubsData(schoolFilter ?? undefined), [schoolFilter]);

  const { data, loading: isLoading } = useBackendQuery(fetchClubs, EMPTY_DATA, schoolFilter);
  const clubs = data.clubs;
  const allCategories = data.categories;

  // Derive filtered clubs from source data (no useState+useEffect sync needed)
  const filteredClubs = useMemo(() => {
    if (isLoading) return [];
    return filterClubs(clubs, {
      searchQuery,
      categories: selectedCategories,
    });
  }, [clubs, searchQuery, selectedCategories, isLoading]);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  return {
    searchQuery,
    setSearchQuery,
    selectedCategories,
    setSelectedCategories,
    clubs,
    allCategories,
    filteredClubs,
    isLoading,
    toggleCategory,
  };
}
