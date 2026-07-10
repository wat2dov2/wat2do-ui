import { useMemo, useEffect, useState } from "react";
import {
  filterAdminEvents,
  getEventCategories,
} from "@/features/admin/utils/eventFilters";
import { useAdminStore } from "@/features/admin/store/admin.store";
import type { Event } from "@/shared/types";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { QP } from "@/shared/constants/queryParams";
import { usePagination } from "@/shared/hooks";
import { useMutableSearchParams } from "@/shared/hooks/useMutableSearchParams";

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
  const [highlightedEventId, setHighlightedEventId] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useMutableSearchParams();
  const reportedEventIds = useAdminStore((s) => s.reportedEventIds);
  const fetchReportedEventIds = useAdminStore((s) => s.fetchReportedEventIds);

  // Defer to the admin store (TTL-cached) for reported event IDs.
  useEffect(() => {
    fetchReportedEventIds().catch((err) =>
      console.error("Failed to fetch reported events:", err),
    );
  }, [fetchReportedEventIds]);

  const eventIdParam = searchParams.get(QP.EVENT_ID);
  const selectedEvent = useMemo(() => {
    if (eventIdParam) {
      const eventId = parseInt(eventIdParam, 10);
      if (!isNaN(eventId)) {
        return events.find((e) => e.id === eventId) || null;
      }
    }
    return null;
  }, [eventIdParam, events]);

  useEffect(() => {
    if (!eventIdParam) return;
    const eventId = parseInt(eventIdParam, 10);
    if (isNaN(eventId)) return;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const rafId = requestAnimationFrame(() => {
      setHighlightedEventId(eventId);
      timeoutId = setTimeout(() => {
        const element = document.getElementById(`event-${eventId}`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, SCROLL_INTO_VIEW_DELAY_MS);
    });
    return () => {
      cancelAnimationFrame(rafId);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [eventIdParam]);

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
    highlightedEventId,
    currentPage,
    selectedEvent,
    categories,
    filteredEvents,
    paginatedEvents,
    totalPages,
    searchParams,
    setSearchParams,
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
