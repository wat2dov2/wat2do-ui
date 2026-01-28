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
    // Search query filter
    if (
      filters.searchQuery &&
      !event.title.toLowerCase().includes(filters.searchQuery.toLowerCase())
    ) {
      return false;
    }

    // Saved filter - only show saved events
    if (filters.savedFilter && !filters.savedEventIds.includes(event.id)) {
      return false;
    }

    // Quick filters (these override the advanced filters when active)
    if (filters.todayFilter && event.date !== "Today") return false;
    if (filters.freeFilter && event.price !== 0) return false;
    if (
      filters.freeFoodFilter &&
      (event.food.length === 0 || event.price > 0)
    ) {
      return false;
    }
    if (
      filters.forYouFilter &&
      filters.profileCompleted &&
      filters.selectedCategories.length > 0 &&
      !filters.selectedCategories.includes(event.category)
    ) {
      return false;
    }

    // Advanced filters (only apply when quick filters are not overriding)
    if (
      !filters.todayFilter &&
      !filters.thisWeekFilter &&
      filters.selectedDays.length > 0 &&
      !filters.selectedDays.includes(event.dayOfWeek || "")
    ) {
      return false;
    }
    if (!filters.freeFilter && !filters.freeFoodFilter) {
      if (
        filters.priceRange.min &&
        event.price < parseFloat(filters.priceRange.min)
      ) {
        return false;
      }
      if (
        filters.priceRange.max &&
        event.price > parseFloat(filters.priceRange.max)
      ) {
        return false;
      }
    }
    if (
      filters.selectedLocations.length > 0 &&
      !filters.selectedLocations.some((loc) => event.location.includes(loc))
    ) {
      return false;
    }
    if (
      filters.includeFoods &&
      filters.selectedFoods.length > 0 &&
      !event.food.some((f) => filters.selectedFoods.includes(f))
    ) {
      return false;
    }
    if (
      !filters.forYouFilter &&
      filters.selectedCategories.length > 0 &&
      !filters.selectedCategories.includes(event.category || "")
    ) {
      return false;
    }
    if (filters.requiresRegistration && !event.requiresRegistration) {
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
        // Handle eventDate - it might be a Date object, string, or undefined
        const getDateValue = (event: Event): number => {
          if (event.eventDate) {
            // Check if it's already a Date object
            if (event.eventDate instanceof Date) {
              return event.eventDate.getTime();
            }
            // If it's a string, convert it
            if (typeof event.eventDate === "string") {
              const date = new Date(event.eventDate);
              return isNaN(date.getTime()) ? 0 : date.getTime();
            }
          }
          // Fallback to parsing the date string
          const date = new Date(event.date);
          return isNaN(date.getTime()) ? 0 : date.getTime();
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
        comparison = a.location.localeCompare(b.location);
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

/**
 * Calculate filter counts for UI display
 */
export function getFilterCounts(filters: {
  selectedCategories: string[];
  selectedLocations: string[];
  selectedFoods: string[];
  selectedDays: string[];
  priceRange: { min: string; max: string };
  dateRange?: Date;
  requiresRegistration: boolean;
}): number {
  return (
    filters.selectedCategories.length +
    filters.selectedLocations.length +
    filters.selectedFoods.length +
    filters.selectedDays.length +
    (filters.priceRange.min || filters.priceRange.max ? 1 : 0) +
    (filters.dateRange ? 1 : 0) +
    (filters.requiresRegistration ? 1 : 0)
  );
}
