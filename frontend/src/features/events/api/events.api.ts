/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import type { Event, EventFormData } from "@/shared/types";
import type {
  ApiEventAttendeesResponse,
  ApiEventFeedResponse,
  ApiLatestAddedItem,
  ApiEventPublicResponse,
  ApiEventResponse,
  ApiEventStatsResponse,
  ApiGoingEventSelection,
  ApiGoingEventSelectionUpdate,
  ApiGoingEventStatusResponse,
} from "@/shared/generated";
import {
  buildEventPayload,
  buildEventUpdatePayload,
} from "@/shared/api/eventPayload";
import { api, getPaginatedItems, isApiError, type PaginatedApiResponse } from "@/shared/services/apiClient";
import { getQueryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";

export type LatestAddedEvent = ApiLatestAddedItem | null;

export type PaginatedEventsResponse = Omit<ApiEventFeedResponse, "items" | "latest_added_event"> & {
  items: Event[];
  latest_added_event: LatestAddedEvent;
};

/**
 * Fetch a single event by ID from the backend API (full details for edit form).
 */
export async function fetchEventById(id: number): Promise<Event> {
  return api.get<ApiEventPublicResponse>(`/events/${id}`);
}

export async function fetchEventFeed(
  school?: string,
  { clubId, includePast = false }: EventFeedOptions = {},
): Promise<Event[]> {
  const params = new URLSearchParams({
    sort_by: "date",
    sort_order: "asc",
  });
  if (school) params.append("school", school);
  if (clubId != null) {
    params.append("club_ids", String(clubId));
  }
  if (includePast) {
    params.append("include_past", "true");
  }
  return getPaginatedItems<Event>(`/events/?${params.toString()}`);
}

interface EventFeedOptions {
  clubId?: number;
  /** Drop the server's start-of-today lower bound and return past events too. */
  includePast?: boolean;
}

/**
 * Every event a host has ever run, past included.
 *
 * The club page is the host's whole record, not just what is still to
 * come, so it opts out of the feed's default start-of-today lower bound.
 */
export async function fetchClubEvents(
  clubId: number,
  school: string,
): Promise<Event[]> {
  return fetchEventFeed(school, { clubId, includePast: true });
}

export async function createEventAPI(eventData: EventFormData): Promise<Event> {
  const event = await api.post<ApiEventResponse>("/events/", buildEventPayload(eventData));
  await invalidateEventQueries();
  return event;
}

export async function updateEventAPI(
  eventId: number,
  eventData: EventFormData,
): Promise<Event> {
  const event = await api.patch<ApiEventResponse>(
    `/events/${eventId}`,
    buildEventUpdatePayload(eventData),
  );
  getQueryClient().setQueryData(queryKeys.events.detail(eventId), event);
  await invalidateEventQueries();
  return event;
}

export async function deleteEventAPI(eventId: number): Promise<void> {
  try {
    await api.delete(`/events/${eventId}`);
  } catch (error) {
    // A previous delete may have committed before its response was lost.
    if (!isApiError(error) || error.status !== 404) throw error;
  }

  await removeDeletedEventFromQueries(eventId);
  // The write is finished. A slow or unavailable read must not hold the delete
  // dialog open or prevent the browse snapshot from dropping the event.
  void invalidateEventQueries();
}

async function removeDeletedEventFromQueries(eventId: number): Promise<void> {
  const queryClient = getQueryClient();
  // Cancel old reads before applying the confirmed deletion so their responses
  // cannot put the event back. Cancellation does not wait for network requests.
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.events.all }),
    queryClient.cancelQueries({ queryKey: queryKeys.admin.lists("events") }),
    queryClient.cancelQueries({ queryKey: queryKeys.goingEvents.all }),
  ]);
  queryClient.removeQueries({ queryKey: queryKeys.events.detail(eventId) });
  queryClient.removeQueries({ queryKey: queryKeys.events.attendees(eventId) });
  queryClient.setQueriesData<Event[]>(
    { queryKey: queryKeys.events.lists() },
    (events) => events?.filter((event) => event.id !== eventId),
  );
  queryClient.setQueriesData<PaginatedApiResponse<Event>>(
    { queryKey: queryKeys.admin.lists("events") },
    (page) => {
      if (!page?.items.some((event) => event.id === eventId)) return page;
      const items = page.items.filter((event) => event.id !== eventId);
      const total = Math.max(0, page.total - (page.items.length - items.length));
      return { ...page, items, total, total_pages: Math.ceil(total / page.page_size) };
    },
  );
  queryClient.setQueriesData<ApiGoingEventSelection[]>(
    { queryKey: queryKeys.goingEvents.all },
    (selections) => selections?.filter((selection) => selection.event_id !== eventId),
  );
}

async function invalidateEventQueries(): Promise<void> {
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.events.all }),
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.all }),
  ]);
}

export type EventStats = ApiEventStatsResponse;

/** Public who's-going summary (count + abbreviated display names). */
export async function fetchEventAttendees(eventId: number): Promise<ApiEventAttendeesResponse> {
  return api.get<ApiEventAttendeesResponse>(`/going-events/${eventId}/attendees`);
}

export async function fetchGoingEvents(): Promise<ApiGoingEventSelection[]> {
  return api.get<ApiGoingEventSelection[]>("/going-events/");
}

export async function setGoingEventOccurrences(
  eventId: number,
  occurrenceIds: string[],
): Promise<ApiGoingEventStatusResponse> {
  const body: ApiGoingEventSelectionUpdate = { occurrence_ids: occurrenceIds };
  return api.put<ApiGoingEventStatusResponse>(`/going-events/${eventId}`, body);
}

export async function clearGoingEvent(
  eventId: number,
): Promise<ApiGoingEventStatusResponse> {
  return api.delete<ApiGoingEventStatusResponse>(`/going-events/${eventId}`);
}

export async function fetchEventStatsFromBackend(
  school: string,
): Promise<Record<string, EventStats>> {
  const params = new URLSearchParams({ school });
  return api.get<Record<string, EventStats>>(`/events/stats?${params.toString()}`);
}

export async function reportEventToBackend(eventId: number, reason: string): Promise<void> {
  await api.post("/reports/", { event_id: eventId, reason });
  await getQueryClient().invalidateQueries({ queryKey: queryKeys.admin.all });
}
