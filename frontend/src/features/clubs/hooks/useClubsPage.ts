/**
 * Clubs Page Hook
 * Manages data loading and filtering for ClubsPage
 */

import { useState, useEffect, useMemo } from "react";
import type { Club } from "@/shared/types";
import {
  loadClubsData,
  filterClubs,
} from "@/features/clubs/api/clubs.api";

export function useClubsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [clubs, setClubs] = useState<Club[]>([]);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load clubs and categories
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const { clubs: loadedClubs, categories } = await loadClubsData();
        setClubs(loadedClubs);
        setAllCategories(categories);
      } catch (error) {
        console.error("Failed to load clubs data:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

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
