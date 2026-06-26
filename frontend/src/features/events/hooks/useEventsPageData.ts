import { useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "@/features/search";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { toast } from "@/shared/hooks/use-toast";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { getDatePresetWindow } from "@/shared/utils/date";
import { getUniqueEvents } from "@/shared/utils/event";
import type { EventListQuery } from "@/features/events/api/events.api";

interface UseEventsPageDataOptions {
  profileCompleted: boolean;
}

/**
 * Hook that aggregates all data orchestration for the EventsPageContainer:
 * events store, saved events, promotions, search/filters, and derived
 * ordered events.
 */
export function useEventsPageData({ profileCompleted }: UseEventsPageDataOptions) {
  const { t } = useTranslation();
  // Read from stores (single source of truth -- no duplicate fetches)
  const events = useEventsStore((s) => s.events);
  const promotedEvents = useEventsStore((s) => s.promotedEvents);
  const isLoading = useEventsStore((s) => s.isLoading);
  const isLoadingMore = useEventsStore((s) => s.isLoadingMore);
  const error = useEventsStore((s) => s.error);
  const totalEvents = useEventsStore((s) => s.totalEvents);
  const hasMoreEvents = useEventsStore((s) => s.hasMoreEvents);
  const fetchEvents = useEventsStore((s) => s.fetchEvents);
  const loadMoreEvents = useEventsStore((s) => s.loadMoreEvents);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const savedEventIds = useSavedEventsStore((s) => s.savedEventIds);

  const filters = useSearch({
    events,
    profileCompleted,
    savedEventIds,
  });

  const eventQuery = useMemo<EventListQuery>(() => {
    const minPrice = parsePrice(filters.priceRange.min);
    const maxPrice = parsePrice(filters.priceRange.max);
    const dateWindow = getDatePresetWindow(filters.datePreset);
    return {
      search: filters.searchQuery || undefined,
      categories: filters.selectedCategories,
      locations: filters.selectedLocations,
      foods: filters.selectedFoods,
      days: filters.selectedDays,
      minPrice,
      maxPrice,
      registration: filters.registration ? true : undefined,
      organizations: filters.selectedOrganizations,
      freeFood: filters.freeFoodFilter,
      ids: filters.savedFilter ? savedEventIds : undefined,
      sortBy: filters.sortBy,
      sortOrder: filters.sortOrder,
      startUtc: dateWindow?.start.toISOString(),
      endUtc: dateWindow?.end.toISOString(),
    };
  }, [
    filters.searchQuery,
    filters.selectedCategories,
    filters.selectedLocations,
    filters.selectedFoods,
    filters.selectedDays,
    filters.datePreset,
    filters.priceRange.min,
    filters.priceRange.max,
    filters.registration,
    filters.selectedOrganizations,
    filters.freeFoodFilter,
    filters.savedFilter,
    filters.sortBy,
    filters.sortOrder,
    savedEventIds,
  ]);

  // Trigger event fetch on mount of the events page (single fetch view architecture)
  const refreshEvents = useCallback(() => {
    void fetchEvents(eventQuery);
  }, [eventQuery, fetchEvents]);

  useEffect(() => {
    void fetchEvents(eventQuery);
  }, [eventQuery, fetchEvents]);

  // The backend owns feed ordering. Preserve that API order exactly so
  // infinite-scroll appends cannot make already-rendered cards jump around.
  const orderedEvents = useMemo(() => {
    return getUniqueEvents(events);
  }, [events]);

  const handleDeleteEvent = useCallback(
    async (eventId: number) => {
      try {
        await deleteEvent(eventId);
      } catch (err) {
        console.error("Failed to delete event:", err);
        const message = getApiErrorMessage(err, t("events.deleteFailed"));
        toast({
          title: "Delete Failed",
          description: message,
          variant: "destructive",
        });
      }
    },
    [deleteEvent, t]
  );

  return {
    isLoading,
    isLoadingMore,
    error,
    fetchEvents: refreshEvents,
    loadMoreEvents,
    totalEvents,
    hasMoreEvents,
    savedEventIds,
    promotedEvents,
    filters,
    orderedEvents,
    handleDeleteEvent,
  };
}

function parsePrice(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
