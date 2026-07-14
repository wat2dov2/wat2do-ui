import { useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useSearch } from "@/features/search";
import { useEventsStore } from "@/features/events/store/events.store";
import { useGoingEventsStore } from "@/features/events/store/goingEvents.store";
import { useGoingCounts } from "@/features/events/hooks/useGoingCounts";
import { useCreditsStore } from "@/features/credits/store/credits.store";
import { toast } from "@/shared/hooks/use-toast";
import { getApiErrorMessage } from "@/shared/services/apiClient";
import { getUniqueEvents } from "@/shared/utils/event";
import type { Event } from "@/shared/types";
import type { ViewMode } from "@/shared/types";

interface UseEventsPageDataOptions {
  profileCompleted: boolean;
  viewMode: ViewMode;
}

function derivePromotedEvents(
  snapshotPromoted: Event[],
  allEvents: Event[],
  activePromotedIds: number[],
): Event[] {
  const byId = new Map<number, Event>();

  for (const event of snapshotPromoted) {
    byId.set(event.id, event);
  }

  for (const id of activePromotedIds) {
    if (byId.has(id)) continue;
    const event = allEvents.find((item) => item.id === id);
    if (event) {
      byId.set(id, event);
    }
  }

  return Array.from(byId.values());
}

/**
 * Hook that aggregates data orchestration for the EventsPageContainer:
 * embedded browse snapshot, going events, client-side counts overlay,
 * search/filters, and derived ordered events.
 */
export function useEventsPageData({ profileCompleted, viewMode }: UseEventsPageDataOptions) {
  const { t } = useTranslation();
  const router = useRouter();
  const deleteEvent = useEventsStore((s) => s.deleteEvent);
  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const goingEventIds = useGoingEventsStore((s) => s.goingEventIds);
  const { data: goingCountsData, isSuccess: goingCountsReady } = useGoingCounts(schoolFilter);
  const goingCounts = goingCountsReady ? (goingCountsData ?? {}) : null;
  const activePromotedEventIds = useCreditsStore((s) => s.activePromotedEventIds);

  const events = useEventsStore((s) => s.events);
  const snapshotPromotedEvents = useEventsStore((s) => s.promotedEvents);
  const latestAddedEvent = useEventsStore((s) => s.latestAddedEvent);
  const isLoading = useEventsStore((s) => s.isLoading);
  const error = useEventsStore((s) => s.error);

  const filters = useSearch({
    events,
    profileCompleted,
    goingEventIds,
    viewMode,
  });

  const orderedEvents = useMemo(
    () => getUniqueEvents(filters.filteredEvents),
    [filters.filteredEvents],
  );

  const promotedEvents = useMemo(
    () => derivePromotedEvents(snapshotPromotedEvents, events, activePromotedEventIds),
    [snapshotPromotedEvents, events, activePromotedEventIds],
  );

  const totalEvents = filters.filteredEvents.length;

  const refreshEvents = useCallback(() => {
    router.refresh();
  }, [router]);

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
    error,
    refreshEvents,
    totalEvents,
    goingEventIds,
    goingCounts,
    schoolFilter,
    latestAddedEvent,
    promotedEvents,
    filters,
    orderedEvents,
    allEvents: events,
    handleDeleteEvent,
  };
}
