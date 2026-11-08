/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import { queryOptions } from "@tanstack/react-query";
import type { Event, EventFormData, FilterState } from "@/shared/types";
import { getDefaultEventCategory } from "@/shared/data/eventCategories";
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
import { resolveSchool } from "@/shared/constants/schools";
import { fetchDiscoverySnapshot, preserveDiscoveryGeneration, type DiscoverySnapshotMetadata } from "@/shared/api/discovery.api";

export type LatestAddedEvent = ApiLatestAddedItem | null;

export type PaginatedEventsResponse = Omit<ApiEventFeedResponse, "items" | "latest_added_event"> & DiscoverySnapshotMetadata & {
  items: Event[];
  latest_added_event: LatestAddedEvent;
};

/**
 * Fetch a single event by ID from the backend API (full details for edit form).
 */
export async function fetchEventById(id: number): Promise<Event> {
  return api.get<ApiEventPublicResponse>(`/events/${id}`);
}

type FeedQuery = Record<string, string | string[]>;

/** Every page of one feed read straight from the API; the browse snapshot holds only what is still on. */
async function fetchFeedEvents(query: FeedQuery): Promise<Event[]> {
  const directory = await collectPaginatedPages((page) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(controlBox.eventDiscovery.serverFeedPageSize),
    });
    for (const [name, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : [value]) params.append(name, item);
    }
    return api.get<PaginatedEventsResponse>(`/events/?${params.toString()}`);
  });
  return directory.items;
}

/** Every event a host has ever run, past included. */
export async function fetchClubEvents(clubId: number, school: string): Promise<Event[]> {
  return fetchFeedEvents({ school, club_ids: String(clubId), include_past: "true" });
}

/** The API's search length limit (`MAX_SEARCH_QUERY_LENGTH`); a longer search is refused. */
const API_SEARCH_MAX_LENGTH = 200;
/** The API's price bound (`MAX_EVENT_PRICE`). */
const API_PRICE_MAX = 100_000;
/** Club terms the API's ILIKE match reads exactly as typed (its sanitizing leaves them unchanged). */
const PLAIN_CLUB_TERM = /^[\p{L}\p{N}_'-]+(?: [\p{L}\p{N}_'-]+)*$/u;

/**
 * The reader's query as feed parameters the API can apply before it limits its
 * read, so a filter-only history read is not just the latest occurrences.
 * Only parameters that keep everything the site's own filters keep are sent:
 * the site still filters the result, and it is the source of truth.
 */
export function pastEventsApiQuery(query: FilterState): FeedQuery {
  const params: FeedQuery = {};
  // A prefix of the search keeps every event the whole search matches.
  const search = query.searchQuery.trim().slice(0, API_SEARCH_MAX_LENGTH);
  if (search) params.search = search;
  // An event with no category counts as the default one on the site, which the API cannot see.
  if (query.categories.length > 0 && !query.categories.includes(getDefaultEventCategory())) {
    params.categories = query.categories;
  }
  const locations = query.locations.map(value => value.trim()).filter(Boolean);
  if (locations.length > 0) params.locations = locations;
  const foods = query.foods.map(value => value.trim()).filter(Boolean);
  if (foods.length > 0) params.foods = foods;
  if (query.days.length > 0) params.days = query.days;
  // A missing price counts as free on the site and fails any price bound in the API, so only
  // a minimum above zero (which the site also never meets with no price) goes along.
  const minPrice = Number.parseFloat(query.minPrice);
  if (minPrice > 0 && minPrice <= API_PRICE_MAX) params.min_price = String(minPrice);
  if (query.registration) params.registration = "true";
  const clubs = query.clubs.map(value => value.trim());
  if (clubs.length > 0 && clubs.every(term => PLAIN_CLUB_TERM.test(term))) params.clubs = clubs;
  if (query.hasFood) params.has_food = "true";
  return params;
}

/**
 * A school's events that started before now (still on at `startUtc`, or ever
 * when it is null) and match the reader's query, newest first: what the browse
 * snapshot leaves out once the reader moves the start filter back. The API
 * narrows the history by the query before it limits the read, and the site's
 * own filters then run over these exactly as over the snapshot.
 */
export function pastEventsQueryOptions(school: string, query: FilterState, startUtc: string | null) {
  const resolvedSchool = resolveSchool(school);
  const filters = pastEventsApiQuery(query);
  return queryOptions({
    queryKey: queryKeys.events.past(resolvedSchool, filters, startUtc),
    queryFn: () => fetchFeedEvents({
      ...filters,
      school: resolvedSchool,
      // An explicit start replaces the API's default lower bound; without one, `include_past` lifts it.
      ...(startUtc ? { start_utc: startUtc } : { include_past: "true" }),
      end_utc: new Date().toISOString(),
      sort_order: "desc",
    }),
  });
}

/** The complete school feed is shared by browsing and related-event surfaces. */
export function eventFeedQueryOptions(school: string) {
  const resolvedSchool = resolveSchool(school);
  return queryOptions({
    queryKey: queryKeys.events.bySchool(resolvedSchool),
    queryFn: () => fetchDiscoverySnapshot<PaginatedEventsResponse>(resolvedSchool, "events"),
    structuralSharing: preserveDiscoveryGeneration,
    retry: false,
  });
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
  const event = await api.patch<ApiEventResponse>(`/events/${eventId}`, buildEventUpdatePayload(eventData));
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
  const confirmedAt = Date.now();
  await cancelEventReads();
  queryClient.setQueryData(queryKeys.events.detail(event.id), event);
  for (const [key, feed] of queryClient.getQueriesData<PaginatedEventsResponse>({ queryKey: queryKeys.events.feeds() })) {
    if (!feed) continue;
    const existing = feed.items.find(item => item.id === event.id);
    const belongsToSchool = key.at(-1) === event.school;
    if (!existing && !belongsToSchool) continue;
    queryClient.setQueryData(key, mergeEventIntoFeed(feed, event, belongsToSchool, confirmedAt));
  }
  for (const [key, events] of queryClient.getQueriesData<Event[]>({ queryKey: queryKeys.events.lists() })) {
    if (!events) continue;
    const existing = events.find(item => item.id === event.id);
    const belongsToClub = [event.club_id, ...(event.cohosts ?? []).map(club => club.id)].includes(key.at(-2) as number) && key.at(-1) === event.school;
    if (!existing && !belongsToClub) continue;
    const items = events.filter(item => item.id !== event.id);
    if (belongsToClub) items.push(mergeEventSummary(existing, event));
    queryClient.setQueryData(key, orderClubEvents(items, Date.now()));
  }
  if (event.school) {
    const schoolFeed = queryClient.getQueryState(queryKeys.events.bySchool(event.school));
    if (!schoolFeed?.data) {
      // The canonical generation can predate a direct submission. Preserve the
      // confirmed write while retaining every event from the complete read.
      updatePendingSchoolFeed(event.school, (feed) => {
        const detail = queryClient.getQueryState<Event>(queryKeys.events.detail(event.id));
        if (!detail?.data || detail.data.school !== event.school) return feed;
        const latestConfirmedAt = Math.max(confirmedAt, detail.dataUpdatedAt);
        if ((feed.generated_at ?? 0) >= latestConfirmedAt) return feed;
        return mergeEventIntoFeed(feed, detail.data, true, latestConfirmedAt);
      });
    }
  }
}

/** An initial complete read is shared by every confirmation waiting to merge. */
function cancelEventReads() {
  return getQueryClient().cancelQueries({
    queryKey: queryKeys.events.all,
    predicate: (query) => query.queryKey[1] !== queryKeys.events.feeds()[1] || query.state.data !== undefined,
  });
}

function updatePendingSchoolFeed(
  school: string,
  update: (feed: PaginatedEventsResponse) => PaginatedEventsResponse,
) {
  const queryClient = getQueryClient();
  void queryClient.fetchQuery(eventFeedQueryOptions(school)).then(() => {
    queryClient.setQueryData<PaginatedEventsResponse>(queryKeys.events.bySchool(school),
      (feed) => feed ? update(feed) : feed);
  }).catch(() => {
    // Query state owns read errors. A failed refresh cannot undo the write.
  });
}

function mergeEventIntoFeed(
  feed: PaginatedEventsResponse,
  event: Event,
  belongsToSchool: boolean,
  confirmedAt: number,
): PaginatedEventsResponse {
  const existing = feed.items.find(item => item.id === event.id);
  const items = feed.items.filter(item => item.id !== event.id);
  if (belongsToSchool) items.push(mergeEventSummary(existing, event));
  let latest = feed.latest_added_event;
  if (isLatestEvent(latest, existing)) latest = null;
  if (belongsToSchool && (!latest || Date.parse(event.added_at) >= Date.parse(latest.added_at))) {
    latest = latestAddedFrom(event);
  }
  return withFeedItems(feed, items, latest, Math.max(confirmedAt, feed.confirmed_at ?? 0));
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

function latestAddedFrom(event: Event): NonNullable<LatestAddedEvent> {
  return { title: event.title, added_at: event.added_at, club_name: event.club, club_logo_url: event.club_logo_url };
}

/**
 * The feed's latest added event, or the newest visible event once it has ended.
 * Selecting it searches the visible events, so an ended one would find nothing.
 */
export function latestVisibleAddedEvent(
  latest: LatestAddedEvent,
  events: Event[],
  visibleEvents: Event[],
): LatestAddedEvent {
  const isFeedEvent = events.some(event => isLatestEvent(latest, event));
  if (!isFeedEvent || visibleEvents.some(event => isLatestEvent(latest, event))) return latest;
  const newest = visibleEvents.reduce<Event | null>(
    (found, event) => (!found || Date.parse(event.added_at) > Date.parse(found.added_at) ? event : found),
    null,
  );
  return newest && latestAddedFrom(newest);
}

function withFeedItems(
  feed: PaginatedEventsResponse,
  items: Event[],
  latestAddedEvent: LatestAddedEvent,
  confirmedAt = Date.now(),
): PaginatedEventsResponse {
  return { ...feed, items, total: items.length, page_size: items.length, latest_added_event: latestAddedEvent, confirmed_at: confirmedAt };
}

async function removeDeletedEventFromQueries(eventId: number): Promise<void> {
  const queryClient = getQueryClient();
  const confirmedAt = Date.now();
  // Cancel old reads before applying the confirmed deletion so their responses
  // cannot put the event back. Cancellation does not wait for network requests.
  await Promise.all([
    cancelEventReads(),
    queryClient.cancelQueries({ queryKey: queryKeys.admin.lists("events") }),
    queryClient.cancelQueries({ queryKey: queryKeys.goingEvents.all }),
  ]);
  queryClient.removeQueries({ queryKey: queryKeys.events.detail(eventId) });
  queryClient.removeQueries({ queryKey: queryKeys.events.attendees(eventId) });
  for (const [key, feed] of queryClient.getQueriesData<PaginatedEventsResponse>({ queryKey: queryKeys.events.feeds() })) {
    const school = key.at(-1);
    if (feed || typeof school !== "string" || queryClient.getQueryState(key)?.fetchStatus !== "fetching") continue;
    updatePendingSchoolFeed(school, (snapshot) => {
      if ((snapshot.generated_at ?? 0) >= confirmedAt) return snapshot;
      const removed = snapshot.items.find(event => event.id === eventId);
      return withFeedItems(snapshot, snapshot.items.filter(event => event.id !== eventId),
        isLatestEvent(snapshot.latest_added_event, removed) ? null : snapshot.latest_added_event,
        Math.max(confirmedAt, snapshot.confirmed_at ?? 0));
    });
  }
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
