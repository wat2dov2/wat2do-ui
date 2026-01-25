import type { Event, EventFormData } from "@/types";

/**
 * Event Service
 * Handles event CRUD operations, filtering, and sorting
 */

export interface EventFilters {
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
 * Filter events based on filter criteria
 */
export function filterEvents(
  events: Event[],
  filters: EventFilters
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
        const dateA = a.eventDate?.getTime() || new Date(a.date).getTime();
        const dateB = b.eventDate?.getTime() || new Date(b.date).getTime();
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
 * Create a new event from form data
 */
export function createEvent(
  eventData: EventFormData,
  getDayOfWeek: (date: string) => string
): Event {
  const newId = Date.now();
  return {
    id: newId,
    title: eventData.title,
    category: eventData.category || "Events",
    organization: eventData.organization,
    location: eventData.location,
    date: eventData.date,
    time: eventData.time,
    isLive: false,
    food: eventData.food || [],
    price: eventData.price || 0,
    dayOfWeek: getDayOfWeek(eventData.date),
    requiresRegistration: eventData.requiresRegistration || false,
    addedDate: new Date(),
    description: eventData.description || "",
    eventDate: new Date(eventData.date),
  };
}

/**
 * Update an existing event
 */
export function updateEvent(
  event: Event,
  eventData: EventFormData,
  getDayOfWeek: (date: string) => string
): Event {
  return {
    ...event,
    title: eventData.title,
    description: eventData.description || "",
    date: eventData.date,
    time: eventData.time,
    location: eventData.location,
    category: eventData.category || "Events",
    price: eventData.price || 0,
    food: eventData.food || [],
    requiresRegistration: eventData.requiresRegistration || false,
    organization: eventData.organization,
    dayOfWeek: getDayOfWeek(eventData.date),
    eventDate: new Date(eventData.date),
  };
}

/**
 * Get event by ID
 */
export function getEventById(events: Event[], id: number): Event | undefined {
  return events.find((event) => event.id === id);
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
