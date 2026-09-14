import { useEffect, useMemo, useState } from "react";
import {
  filterAdminEvents,
  getEventCategories,
} from "@/features/admin/utils/eventFilters";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import { useAdminStore } from "@/features/admin/store/admin.store";
import { REPORT_PENDING } from "@/shared/constants/statuses";
import type { Event } from "@/shared/types";
import { usePagination } from "@/shared/hooks";

interface UseAdminEventsPageOptions {
  events: Event[];
}

export function useAdminEventsPage({
  events,
}: UseAdminEventsPageOptions) {
  const [searchQuery, setSearchQueryState] = useState("");
  const [selectedCategory, setSelectedCategoryState] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const reports = useAdminStore(s => s.reports);
  const reportsLoadedAt = useAdminStore(s => s.loadedAt.reports);
  const fetchReports = useAdminStore(s => s.fetchReports);
  const [reportsError, setReportsError] = useState(false);
  const [reportAttempt, setReportAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchReports(reportAttempt > 0).then(() => {
      if (!cancelled) setReportsError(false);
    }).catch(() => {
      if (!cancelled) setReportsError(true);
    });
    return () => { cancelled = true; };
  }, [fetchReports, reportAttempt]);

  const pendingReports = useMemo(
    () => reports.filter(report => report.status === REPORT_PENDING),
    [reports],
  );

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
    });
  }, [events, searchQuery, selectedCategory]);

  const {
    currentPage,
    setCurrentPage,
    totalPages,
    paginatedItems: paginatedEvents,
  } = usePagination({
    items: filteredEvents,
    itemsPerPage: ADMIN_ITEMS_PER_PAGE,
  });

  return {
    pendingReports,
    reportsLoading: reportsLoadedAt === undefined && !reportsError,
    reportsError,
    retryReports: () => setReportAttempt(value => value + 1),
    searchQuery,
    selectedCategory,
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
    setDeleteConfirmId,
    setCurrentPage,
  };
}
