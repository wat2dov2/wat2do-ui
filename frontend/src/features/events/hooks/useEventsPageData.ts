import { useMemo, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "@/features/search";
import { useEventsStore } from "@/features/events/store/events.store";
import { useSavedEventsStore } from "@/features/events/store/savedEvents.store";
import { toast } from "@/shared/hooks/use-toast";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { getUniqueEvents } from "@/shared/utils/event";
import type { EventListQuery } from "@/features/events/api/events.api";
import {
  eventsFeedHasMore,
  flattenEventsFeedPages,
  useEventsFeed,
  usePromotedEvents,
} from "@/features/events/hooks/useEventsFeed";

interface UseEventsPageDataOptions {
  profileCompleted: boolean;
}

/**
 * Hook that aggregates all data orchestration for the EventsPageContainer:
 * events feed queries, saved events, promotions, search/filters, and derived
 * ordered events.
 */
export function useEventsPageData({ profileCompleted }: UseEventsPageDataOptions) {
  const { t } = useTranslation();
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const savedEventIds = useSavedEventsStore((s) => s.savedEventIds);

  const events = useEventsStore((s) => s.events);
  const promotedEvents = useEventsStore((s) => s.promotedEvents);
  const latestAddedEvent = useEventsStore((s) => s.latestAddedEvent);
  const isLoading = useEventsStore((s) => s.isLoading);
  const isLoadingMore = useEventsStore((s) => s.isLoadingMore);
  const error = useEventsStore((s) => s.error);
  const totalEvents = useEventsStore((s) => s.totalEvents);
  const hasMoreEvents = useEventsStore((s) => s.hasMoreEvents);

  const filters = useSearch({
    events,
    profileCompleted,
    savedEventIds,
  });

  const eventQuery = useMemo<EventListQuery>(() => {
    const minPrice = parsePrice(filters.priceRange.min);
    const maxPrice = parsePrice(filters.priceRange.max);
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
      addedWithin24h: filters.addedWithin24h || undefined,
    };
  }, [
    filters.searchQuery,
    filters.selectedCategories,
    filters.selectedLocations,
    filters.selectedFoods,
    filters.selectedDays,
    filters.priceRange.min,
    filters.priceRange.max,
    filters.registration,
    filters.selectedOrganizations,
    filters.freeFoodFilter,
    filters.savedFilter,
    filters.sortBy,
    filters.sortOrder,
    filters.addedWithin24h,
    savedEventIds,
  ]);

  const feedQuery = useEventsFeed(schoolFilter, eventQuery);
  const promotedQuery = usePromotedEvents(schoolFilter);

  const flattenedFeed = useMemo(
    () => flattenEventsFeedPages(feedQuery.data?.pages),
    [feedQuery.data?.pages],
  );

  useEffect(() => {
    const feedError = feedQuery.error
      ? getApiErrorMessage(feedQuery.error, t("events.loadFailed"))
      : null;

    useEventsStore.setState({
      events: flattenedFeed?.items ?? [],
      latestAddedEvent: flattenedFeed?.latest_added_event ?? null,
      isLoading: feedQuery.isLoading,
      isLoadingMore: feedQuery.isFetchingNextPage,
      error: feedError,
      eventsPage: flattenedFeed?.page ?? 0,
      eventsPageSize: flattenedFeed?.page_size ?? useEventsStore.getState().eventsPageSize,
      totalEvents: flattenedFeed?.total ?? 0,
      hasMoreEvents: eventsFeedHasMore(feedQuery.data?.pages),
      eventQuery,
    });
  }, [
    eventQuery,
    feedQuery.data?.pages,
    feedQuery.error,
    feedQuery.isFetchingNextPage,
    feedQuery.isLoading,
    flattenedFeed,
    t,
  ]);

  useEffect(() => {
    useEventsStore.setState({
      promotedEvents: promotedQuery.data ?? [],
      isPromotedLoading: promotedQuery.isLoading,
    });
  }, [promotedQuery.data, promotedQuery.isLoading]);

  const refreshEvents = useCallback(() => {
    void feedQuery.refetch();
    void promotedQuery.refetch();
  }, [feedQuery, promotedQuery]);

  const loadMoreEvents = useCallback(() => {
    if (!feedQuery.hasNextPage || feedQuery.isFetchingNextPage) return;
    void feedQuery.fetchNextPage();
  }, [feedQuery]);

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
    [deleteEvent, t],
  );

  return {
    isLoading,
    isLoadingMore,
    error,
    refreshEvents,
    loadMoreEvents,
    totalEvents,
    hasMoreEvents,
    savedEventIds,
    latestAddedEvent,
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
