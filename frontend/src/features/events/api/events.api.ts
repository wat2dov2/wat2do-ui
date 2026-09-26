/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import { queryOptions } from "@tanstack/react-query";
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
import { api, isApiError, type PaginatedApiResponse } from "@/shared/services/apiClient";
import { getQueryClient } from "@/shared/lib/queryClient";
import { queryKeys } from "@/shared/lib/queryKeys";
import { collectPaginatedPages } from "@/shared/lib/pagination";
import { orderClubEvents } from "@/features/events/lib/clubEventOrder";
import { controlBox } from "@/shared/config/controlBox";

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

async function fetchEventFeed(
  school: string,
  clubId?: number,
): Promise<PaginatedEventsResponse> {
  return collectPaginatedPages((page) => {
    const params = new URLSearchParams({
      school,
      page: String(page),
      page_size: String(controlBox.eventDiscovery.serverFeedPageSize),
    });
    if (clubId != null) {
      params.set("club_ids", String(clubId));
      params.set("include_past", "true");
    }
    return api.get<PaginatedEventsResponse>(`/events/?${params.toString()}`);
  });
}

/** The complete school feed is shared by browsing and related-event surfaces. */
export function eventFeedQueryOptions(school: string) {
  return queryOptions({
    queryKey: queryKeys.events.bySchool(school),
    queryFn: () => fetchEventFeed(school),
    retry: false,
  });
}

/** Every event a host has ever run, past included. */
export async function fetchClubEvents(clubId: number, school: string): Promise<Event[]> {
  return (await fetchEventFeed(school, clubId)).items;
}

export async function createEventAPI(eventData: EventFormData): Promise<Event> {
  const event = await api.post<ApiEventResponse>("/events/", buildEventPayload(eventData));
  await writeEventToQueries(event);
  void invalidateEventQueries();
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
  await writeEventToQueries(event);
  void invalidateEventQueries();
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

/** Apply confirmed writes before refreshing so read latency never delays the UI. */
async function writeEventToQueries(event: Event): Promise<void> {
  const queryClient = getQueryClient();
  await queryClient.cancelQueries({ queryKey: queryKeys.events.all });
  queryClient.setQueryData(queryKeys.events.detail(event.id), event);
  for (const [key, feed] of queryClient.getQueriesData<PaginatedEventsResponse>({ queryKey: queryKeys.events.feeds() })) {
    if (!feed) continue;
    const existing = feed.items.find(item => item.id === event.id);
    const belongsToSchool = key.at(-1) === event.school;
    if (!existing && !belongsToSchool) continue;
    const items = feed.items.filter(item => item.id !== event.id);
    if (belongsToSchool) items.push(mergeEventSummary(existing, event));
    let latest = feed.latest_added_event;
    if (isLatestEvent(latest, existing)) latest = null;
    if (belongsToSchool && (!latest || Date.parse(event.added_at) >= Date.parse(latest.added_at))) {
      latest = { title: event.title, added_at: event.added_at };
    }
    queryClient.setQueryData(key, withFeedItems(feed, items, latest));
  }
  for (const [key, events] of queryClient.getQueriesData<Event[]>({ queryKey: queryKeys.events.lists() })) {
    if (!events) continue;
    const existing = events.find(item => item.id === event.id);
    const belongsToClub = key.at(-2) === event.club_id && key.at(-1) === event.school;
    if (!existing && !belongsToClub) continue;
    const items = events.filter(item => item.id !== event.id);
    if (belongsToClub) items.push(mergeEventSummary(existing, event));
    queryClient.setQueryData(key, orderClubEvents(items, Date.now()));
  }
  if (event.school) {
    const schoolFeed = queryClient.getQueryState(queryKeys.events.bySchool(event.school));
    if (!schoolFeed?.data && schoolFeed?.fetchStatus !== "fetching") {
      // Direct submission can happen before browsing. Keep a complete post-write
      // read active when returning to a route with an older prefetched snapshot.
      void queryClient.prefetchQuery(eventFeedQueryOptions(event.school));
    }
  }
}

function mergeEventSummary(existing: Event | undefined, event: Event): Event {
  // The write response omits summary-only social links. Preserve them only if
  // the host is unchanged; reassignment must never retain another club's links.
  const sameHost = existing?.school === event.school && existing.club === event.club &&
    existing.club_id != null && existing.club_id === event.club_id;
  return sameHost ? { ...existing, ...event } : event;
}

function isLatestEvent(latest: LatestAddedEvent, event: Event | undefined): boolean {
  return Boolean(latest && event && latest.added_at === event.added_at && latest.title === event.title);
}

function withFeedItems(
  feed: PaginatedEventsResponse,
  items: Event[],
  latestAddedEvent: LatestAddedEvent,
): PaginatedEventsResponse {
  return { ...feed, items, total: items.length, page_size: items.length, latest_added_event: latestAddedEvent };
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
  queryClient.setQueriesData<PaginatedEventsResponse>(
    { queryKey: queryKeys.events.feeds() },
    (feed) => {
      const removed = feed?.items.find(event => event.id === eventId);
      if (!feed || !removed) return feed;
      return withFeedItems(feed, feed.items.filter(event => event.id !== eventId),
        isLatestEvent(feed.latest_added_event, removed) ? null : feed.latest_added_event);
    },
  );
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
