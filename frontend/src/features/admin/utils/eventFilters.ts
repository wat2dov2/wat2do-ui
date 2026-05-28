import type { Event } from "@/shared/types";

export function filterAdminEvents(
  events: Event[],
  filters: {
    searchQuery?: string;
    selectedCategory?: string;
    showReportedOnly?: boolean;
    reportedEventIds?: Set<number>;
  },
): Event[] {
  let filtered = events;

  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (event) =>
        event.title.toLowerCase().includes(query) ||
        (event.organization ?? "").toLowerCase().includes(query),
    );
  }

  if (filters.selectedCategory) {
    filtered = filtered.filter(
      (event) => event.category === filters.selectedCategory,
    );
  }

  if (filters.showReportedOnly && filters.reportedEventIds) {
    filtered = filtered.filter((event) => filters.reportedEventIds!.has(event.id));
  }

  return filtered;
}

export function getEventCategories(events: Event[]): string[] {
  const categories = new Set<string>();
  events.forEach((event) => {
    if (event.category) categories.add(event.category);
  });
  return Array.from(categories).sort();
}
