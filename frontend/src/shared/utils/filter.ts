import type { EventDateFilter } from "@/shared/types/filter.types";

/** Count narrowing filters, excluding the separate search field and sort order. */
export function getFilterCounts(filters: {
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  minPrice: string;
  maxPrice: string;
  minGoing: number;
  registration: boolean;
  selectedClubs: string[];
  hasFoodFilter: boolean;
  goingFilter: boolean;
  addedSince?: string;
  dateFilter?: EventDateFilter;
}): number {
  return (
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.minPrice ? 1 : 0) +
    (filters.maxPrice ? 1 : 0) +
    (filters.minGoing > 0 ? 1 : 0) +
    (filters.registration ? 1 : 0) +
    filters.selectedClubs.length +
    (filters.hasFoodFilter ? 1 : 0) +
    (filters.goingFilter ? 1 : 0) +
    (filters.addedSince ? 1 : 0) +
    (filters.dateFilter && filters.dateFilter !== "any" ? 1 : 0)
  );
}
