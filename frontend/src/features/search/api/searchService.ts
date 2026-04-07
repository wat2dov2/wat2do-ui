import type { Event } from "@/shared/types";

/**
 * Search Service
 * Core search, filter, and sort operations
 * 
 * This service is domain-agnostic and can filter any collection
 * that matches the Event interface structure.
 */

export interface SearchFilters {
  searchQuery: string;
  savedFilter: boolean;
  todayFilter: boolean;
  freeFilter: boolean;
  freeFoodFilter: boolean;
  forYouFilter: boolean;
  thisWeekFilter: boolean;
  selectedDays: string[];
  priceRange: { min: string; max: string };
  selectedLocations: string[];
  includeFoods: boolean;
  selectedFoods: string[];
  selectedCategories: string[];
  requiresRegistration: boolean;
  profileCompleted: boolean;
  savedEventIds: number[];
}

export interface SortOptions {
  sortBy: string;
  sortOrder: "asc" | "desc";
}

/**
 * Filter events based on search and filter criteria
 */
export function filterEvents(
  events: Event[],
  filters: SearchFilters
): Event[] {
  return events.filter((event) => {
    const food = event.food ?? [];
    const price = event.price ?? 0;
    const category = event.category ?? "";
    const dayOfWeek = event.dayOfWeek ?? "";
    const needsRegistration = event.requiresRegistration ?? event.registration ?? false;

    // Search query filter
    if (
      filters.searchQuery &&
      !event.title.toLowerCase().includes(filters.searchQuery.toLowerCase())
    ) {
      return false;
    }

    // Saved filter
    if (filters.savedFilter && !filters.savedEventIds.includes(event.id)) {
      return false;
    }

    // Quick filters
    if (filters.todayFilter) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const raw = event.dtstart_utc || event.eventDate || event.date;
      if (!raw) return false;
      const eventDate = new Date(raw);
      if (isNaN(eventDate.getTime()) || eventDate < today || eventDate >= tomorrow) return false;
    }
    if (filters.freeFilter && price !== 0) return false;
    if (filters.freeFoodFilter && (food.length === 0 || price > 0)) {
      return false;
    }
    if (
      filters.forYouFilter &&
      filters.profileCompleted &&
      filters.selectedCategories.length > 0 &&
      !filters.selectedCategories.includes(category)
    ) {
      return false;
    }

    // Advanced filters
    if (
      !filters.todayFilter &&
      !filters.thisWeekFilter &&
      filters.selectedDays.length > 0 &&
      !filters.selectedDays.includes(dayOfWeek)
    ) {
      return false;
    }
    if (!filters.freeFilter && !filters.freeFoodFilter) {
      if (filters.priceRange.min && price < parseFloat(filters.priceRange.min)) {
        return false;
      }
      if (filters.priceRange.max && price > parseFloat(filters.priceRange.max)) {
        return false;
      }
    }
    if (
      filters.selectedLocations.length > 0 &&
      !filters.selectedLocations.some((loc) => (event.location ?? "").includes(loc))
    ) {
      return false;
    }
    if (
      filters.includeFoods &&
      filters.selectedFoods.length > 0 &&
      !food.some((f) => filters.selectedFoods.includes(f))
    ) {
      return false;
    }
    if (
      !filters.forYouFilter &&
      filters.selectedCategories.length > 0 &&
      !filters.selectedCategories.includes(category)
    ) {
      return false;
    }
    if (filters.requiresRegistration && !needsRegistration) {
      return false;
    }

    return true;
  });
}

/**
 * Sort events based on sort options
 */
export function sortEvents(
  events: Event[],
  sortOptions: SortOptions
): Event[] {
  const { sortBy, sortOrder } = sortOptions;
  const sorted = [...events];

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "date": {
        const getDateValue = (event: Event): number => {
          if (event.dtstart_utc) {
            const d = new Date(event.dtstart_utc);
            if (!isNaN(d.getTime())) return d.getTime();
          }
          if (event.eventDate) {
            if (event.eventDate instanceof Date) return event.eventDate.getTime();
            if (typeof event.eventDate === "string") {
              const d = new Date(event.eventDate);
              if (!isNaN(d.getTime())) return d.getTime();
            }
          }
          if (event.date) {
            const d = new Date(event.date);
            if (!isNaN(d.getTime())) return d.getTime();
          }
          return 0;
        };
        const dateA = getDateValue(a);
        const dateB = getDateValue(b);
        comparison = dateA - dateB;
        break;
      }
      case "title":
        comparison = a.title.localeCompare(b.title);
        break;
      case "location":
        comparison = (a.location ?? "").localeCompare(b.location ?? "");
        break;
      case "price":
        comparison = (a.price || 0) - (b.price || 0);
        break;
      default:
        return 0;
    }

    return sortOrder === "asc" ? comparison : -comparison;
  });

  return sorted;
}

// Canonical home: shared/utils/filter.ts — re-exported for feature consumers
export { getFilterCounts } from "@/shared/utils/filter";
