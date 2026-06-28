import type { Event } from "@/shared/types";
import { getPrimaryOccurrence } from "@/shared/utils/date";
import { getEventCategory } from "@/shared/utils/event";

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
  freeFoodFilter: boolean;
  selectedDays: string[];
  priceRange: { min: string; max: string };
  selectedLocations: string[];
  selectedFoods: string[];
  selectedCategories: string[];
  registration: boolean;
  profileCompleted: boolean;
  savedEventIds: number[];
  selectedOrganizations: string[];
  addedWithin24h: boolean;
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
  filters: SearchFilters,
): Event[] {
  // Lowercase query once (loop-invariant) instead of recomputing per event.
  const q = filters.searchQuery ? filters.searchQuery.toLowerCase() : "";
  // Set lookup is O(1); .includes on an array is O(n). When savedFilter is
  // active this is run per-event, so hoist and wrap once.
  const savedSet = filters.savedFilter ? new Set(filters.savedEventIds) : null;

  return events.filter((event) => {
    const food = event.food ?? [];
    const price = event.price ?? 0;
    const category = getEventCategory(event);
    const dayOfWeek = getEventDayOfWeek(event);
    const needsRegistration = event.registration ?? false;

    // Search query filter
    if (q && !event.title.toLowerCase().includes(q)) {
      return false;
    }

    // Saved filter
    if (savedSet && !savedSet.has(event.id)) {
      return false;
    }

    // Free-food quick filter
    if (filters.freeFoodFilter && (food.length === 0 || price > 0)) {
      return false;
    }

    // Added within 24 hours quick filter
    if (filters.addedWithin24h) {
      const addedTime = new Date(event.added_at).getTime();
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      if (addedTime < cutoff) {
        return false;
      }
    }

    // Day-of-week filter
    if (filters.selectedDays.length > 0 && !filters.selectedDays.includes(dayOfWeek)) {
      return false;
    }

    // Price range — only applies when the freeFood quick filter is off.
    if (!filters.freeFoodFilter) {
      if (filters.priceRange.min && price < parseFloat(filters.priceRange.min)) {
        return false;
      }
      if (filters.priceRange.max && price > parseFloat(filters.priceRange.max)) {
        return false;
      }
    }

    // Location substring filter
    if (
      filters.selectedLocations.length > 0 &&
      !filters.selectedLocations.some((loc) => (event.location ?? "").includes(loc))
    ) {
      return false;
    }

    // Food filter
    if (
      filters.selectedFoods.length > 0 &&
      !food.some((f) => filters.selectedFoods.includes(f))
    ) {
      return false;
    }

    // Category filter
    if (
      filters.selectedCategories.length > 0 &&
      !filters.selectedCategories.includes(category)
    ) {
      return false;
    }

    // Registration filter
    if (filters.registration && !needsRegistration) {
      return false;
    }

    // Organization filter
    if (
      filters.selectedOrganizations &&
      filters.selectedOrganizations.length > 0 &&
      !filters.selectedOrganizations.includes(event.organization ?? "")
    ) {
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
  sortOptions: SortOptions,
): Event[] {
  const { sortBy, sortOrder } = sortOptions;
  const sorted = [...events];

  sorted.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case "date": {
        const getDateValue = (event: Event): number => {
          const primary = getPrimaryOccurrence(event);
          if (primary && primary.dtstart_utc) {
            const d = new Date(primary.dtstart_utc);
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
      case "added_at": {
        const dateA = new Date(a.added_at).getTime();
        const dateB = new Date(b.added_at).getTime();
        comparison =
          (Number.isNaN(dateA) ? 0 : dateA) -
          (Number.isNaN(dateB) ? 0 : dateB);
        break;
      }
      default:
        return 0;
    }

    return sortOrder === "asc" ? comparison : -comparison;
  });

  return sorted;
}

// Canonical home: shared/utils/filter.ts — re-exported for feature consumers
export { getFilterCounts } from "@/shared/utils/filter";
function getEventDayOfWeek(event: Event): string {
  const primary = getPrimaryOccurrence(event);
  if (!primary || !primary.dtstart_utc) return "";
  const date = new Date(primary.dtstart_utc);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { weekday: "long" });
}
