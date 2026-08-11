import { useMemo, useEffect, useState } from "react";
import {
  filterAdminEvents,
  getEventCategories,
} from "@/features/admin/utils/eventFilters";
import { useAdminStore } from "@/features/admin/store/admin.store";
import type { Event } from "@/shared/types";
import { usePagination } from "@/shared/hooks";

interface UseAdminEventsPageOptions {
  events: Event[];
  itemsPerPage?: number;
}

export function useAdminEventsPage({
  events,
  itemsPerPage = 20,
}: UseAdminEventsPageOptions) {
  const [searchQuery, setSearchQueryState] = useState("");
  const [selectedCategory, setSelectedCategoryState] = useState("");
  const [showReportedOnly, setShowReportedOnly] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const reportedEventIds = useAdminStore((s) => s.reportedEventIds);
  const fetchReportedEventIds = useAdminStore((s) => s.fetchReportedEventIds);

  // Defer to the admin store (TTL-cached) for reported event IDs.
  useEffect(() => {
    fetchReportedEventIds().catch((err) =>
      console.error("Failed to fetch reported events:", err),
    );
  }, [fetchReportedEventIds]);

  const selectedEvent = useMemo(() => {
    if (selectedEventId == null) return null;
    return events.find((event) => event.id === selectedEventId) ?? null;
  }, [events, selectedEventId]);

  const categories = useMemo(() => {
    return getEventCategories(events);
  }, [events]);

  const filteredEvents = useMemo(() => {
    return filterAdminEvents(events, {
      searchQuery,
      selectedCategory,
      showReportedOnly,
      reportedEventIds,
    });
  }, [events, searchQuery, selectedCategory, showReportedOnly, reportedEventIds]);

  const {
    currentPage,
    setCurrentPage,
    totalPages,
    paginatedItems: paginatedEvents,
  } = usePagination({
    items: filteredEvents,
    itemsPerPage,
  });

  const isEventReported = (eventId: number) => {
    return reportedEventIds.has(eventId);
  };

  return {
    searchQuery,
    selectedCategory,
    showReportedOnly,
    deleteConfirmId,
    currentPage,
    selectedEvent,
    categories,
    filteredEvents,
    paginatedEvents,
    totalPages,
    selectEvent: setSelectedEventId,
    clearSelectedEvent: () => setSelectedEventId(null),
    setSearchQuery: (query: string) => {
      setSearchQueryState(query);
      setCurrentPage(1);
    },
    setSelectedCategory: (category: string) => {
      setSelectedCategoryState(category);
      setCurrentPage(1);
    },
    toggleReportedOnly: () => {
      setShowReportedOnly((value) => !value);
      setCurrentPage(1);
    },
    setDeleteConfirmId,
    setCurrentPage,
    isEventReported,
  };
}
