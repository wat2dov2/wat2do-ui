/**
 * Admin Events Page Hook
 * Manages state and logic for AdminEventsPage
 * Uses useReducer for complex state management
 */

import { useReducer, useMemo, useEffect, useRef, startTransition } from "react";
import { useSearchParams } from "react-router-dom";
import {
  filterAdminEvents,
  getEventCategories,
} from "@/features/admin/api/admin.api";
import { useAdminStore } from "@/features/admin/store/admin.store";
import type { Event } from "@/shared/types";
import { SCROLL_INTO_VIEW_DELAY_MS } from "@/shared/constants/ui";
import { QP } from "@/shared/constants/queryParams";

interface AdminEventsPageState {
  searchQuery: string;
  selectedCategory: string;
  showReportedOnly: boolean;
  deleteConfirmId: number | null;
  highlightedEventId: number | null;
  currentPage: number;
}

type AdminEventsPageAction =
  | { type: "SET_SEARCH_QUERY"; payload: string }
  | { type: "SET_SELECTED_CATEGORY"; payload: string }
  | { type: "TOGGLE_REPORTED_ONLY" }
  | { type: "SET_DELETE_CONFIRM_ID"; payload: number | null }
  | { type: "SET_HIGHLIGHTED_EVENT_ID"; payload: number | null }
  | { type: "SET_CURRENT_PAGE"; payload: number }
  | { type: "RESET_PAGE" };

const initialState: AdminEventsPageState = {
  searchQuery: "",
  selectedCategory: "",
  showReportedOnly: false,
  deleteConfirmId: null,
  highlightedEventId: null,
  currentPage: 1,
};

function reducer(
  state: AdminEventsPageState,
  action: AdminEventsPageAction
): AdminEventsPageState {
  switch (action.type) {
    case "SET_SEARCH_QUERY":
      return { ...state, searchQuery: action.payload };
    case "SET_SELECTED_CATEGORY":
      return { ...state, selectedCategory: action.payload };
    case "TOGGLE_REPORTED_ONLY":
      return { ...state, showReportedOnly: !state.showReportedOnly };
    case "SET_DELETE_CONFIRM_ID":
      return { ...state, deleteConfirmId: action.payload };
    case "SET_HIGHLIGHTED_EVENT_ID":
      return { ...state, highlightedEventId: action.payload };
    case "SET_CURRENT_PAGE":
      return { ...state, currentPage: action.payload };
    case "RESET_PAGE":
      return { ...state, currentPage: 1 };
    default:
      return state;
  }
}

interface UseAdminEventsPageOptions {
  events: Event[];
  itemsPerPage?: number;
}

export function useAdminEventsPage({
  events,
  itemsPerPage = 20,
}: UseAdminEventsPageOptions) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [searchParams, setSearchParams] = useSearchParams();
  const reportedEventIds = useAdminStore((s) => s.reportedEventIds);
  const fetchReportedEventIds = useAdminStore((s) => s.fetchReportedEventIds);
  const prevFiltersRef = useRef({
    searchQuery: state.searchQuery,
    selectedCategory: state.selectedCategory,
    showReportedOnly: state.showReportedOnly,
  });

  // Defer to the admin store (TTL-cached) for reported event IDs.
  useEffect(() => {
    fetchReportedEventIds().catch((err) =>
      console.error("Failed to fetch reported events:", err),
    );
  }, [fetchReportedEventIds]);

  // Get eventId from URL
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

  // Check URL parameters on mount for highlighting
  useEffect(() => {
    if (eventIdParam) {
      const eventId = parseInt(eventIdParam, 10);
      if (!isNaN(eventId)) {
        requestAnimationFrame(() => {
          dispatch({ type: "SET_HIGHLIGHTED_EVENT_ID", payload: eventId });
          setTimeout(() => {
            const element = document.getElementById(`event-${eventId}`);
            if (element) {
              element.scrollIntoView({ behavior: "smooth", block: "center" });
            }
          }, SCROLL_INTO_VIEW_DELAY_MS);
        });
      }
    }
  }, [eventIdParam]);

  // Get unique categories using API
  const categories = useMemo(() => {
    return getEventCategories(events);
  }, [events]);

  // Filter events
  const filteredEvents = useMemo(() => {
    return filterAdminEvents(events, {
      searchQuery: state.searchQuery,
      selectedCategory: state.selectedCategory,
      showReportedOnly: state.showReportedOnly,
      reportedEventIds,
    });
  }, [events, state.searchQuery, state.selectedCategory, state.showReportedOnly, reportedEventIds]);

  // Reset to page 1 when filters change
  useEffect(() => {
    if (
      prevFiltersRef.current.searchQuery !== state.searchQuery ||
      prevFiltersRef.current.selectedCategory !== state.selectedCategory ||
      prevFiltersRef.current.showReportedOnly !== state.showReportedOnly
    ) {
      prevFiltersRef.current = {
        searchQuery: state.searchQuery,
        selectedCategory: state.selectedCategory,
        showReportedOnly: state.showReportedOnly,
      };
      startTransition(() => {
        dispatch({ type: "RESET_PAGE" });
      });
    }
  }, [state.searchQuery, state.selectedCategory, state.showReportedOnly]);

  // Pagination
  const totalPages = Math.ceil(filteredEvents.length / itemsPerPage);
  const paginatedEvents = useMemo(() => {
    const startIndex = (state.currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredEvents.slice(startIndex, endIndex);
  }, [filteredEvents, state.currentPage, itemsPerPage]);

  const isEventReported = (eventId: number) => {
    return reportedEventIds.has(eventId);
  };

  return {
    // State
    ...state,
    selectedEvent,
    categories,
    filteredEvents,
    paginatedEvents,
    totalPages,
    searchParams,
    setSearchParams,
    // Actions
    setSearchQuery: (query: string) =>
      dispatch({ type: "SET_SEARCH_QUERY", payload: query }),
    setSelectedCategory: (category: string) =>
      dispatch({ type: "SET_SELECTED_CATEGORY", payload: category }),
    toggleReportedOnly: () => dispatch({ type: "TOGGLE_REPORTED_ONLY" }),
    setDeleteConfirmId: (id: number | null) =>
      dispatch({ type: "SET_DELETE_CONFIRM_ID", payload: id }),
    setCurrentPage: (page: number) =>
      dispatch({ type: "SET_CURRENT_PAGE", payload: page }),
    isEventReported,
  };
}
