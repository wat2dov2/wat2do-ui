/**
 * Events API
 * All events come from the backend. No mock/static data.
 */

import type { Event, EventFormData } from "@/shared/types";
import type {
  ApiEventPublicResponse,
  ApiEventResponse,
  ApiEventSummaryResponse,
  ApiPaginatedEventSummaryResponse,
} from "@/shared/generated";
import { buildEventPayload } from "@/shared/api/eventPayload";
import { api } from "@/shared/services/apiClient";

export interface EventListQuery {
  school?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  categories?: string[];
  locations?: string[];
  foods?: string[];
  days?: string[];
  minPrice?: number;
  maxPrice?: number;
  registration?: boolean;
  organizations?: string[];
  freeFood?: boolean;
  ids?: number[];
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  startUtc?: string;
  endUtc?: string;
}

export type PaginatedEventsResponse = Omit<ApiPaginatedEventSummaryResponse, "items"> & {
  items: Event[];
};

function appendValues(params: URLSearchParams, key: string, values?: Array<string | number>) {
  values?.forEach((value) => {
    params.append(key, String(value));
  });
}

/**
 * Fetch events from backend API.
 *
 * The backend returns the page requested by the current school + filter state.
 */
export async function fetchEventsPage(query: EventListQuery = {}): Promise<PaginatedEventsResponse> {
  if (query.ids && query.ids.length === 0) {
    return {
      items: [],
      total: 0,
      page: query.page ?? 1,
      page_size: query.pageSize ?? 50,
      total_pages: 0,
    };
  }

  const params = new URLSearchParams();
  params.set("page", String(query.page ?? 1));
  params.set("page_size", String(query.pageSize ?? 50));
  if (query.school) params.set("school", query.school);
  if (query.search) params.set("search", query.search);
  appendValues(params, "categories", query.categories);
  appendValues(params, "locations", query.locations);
  appendValues(params, "foods", query.foods);
  appendValues(params, "days", query.days);
  if (query.minPrice !== undefined) params.set("min_price", String(query.minPrice));
  if (query.maxPrice !== undefined) params.set("max_price", String(query.maxPrice));
  if (query.registration !== undefined) params.set("registration", String(query.registration));
  appendValues(params, "organizations", query.organizations);
  if (query.freeFood) params.set("free_food", "true");
  appendValues(params, "ids", query.ids);
  if (query.sortBy) params.set("sort_by", query.sortBy);
  if (query.sortOrder) params.set("sort_order", query.sortOrder);
  if (query.startUtc) params.set("start_utc", query.startUtc);
  if (query.endUtc) params.set("end_utc", query.endUtc);

  const response = await api.get<ApiPaginatedEventSummaryResponse>(`/events/?${params.toString()}`);
  return {
    ...response,
    items: response.items,
  };
}

/**
 * Fetch promoted events from backend API.
 */
export async function fetchPromotedEvents(school?: string): Promise<Event[]> {
  const params = new URLSearchParams();
  if (school) params.set("school", school);
  const qs = params.toString();
  const apiEvents = await api.get<ApiEventSummaryResponse[]>(
    `/events/promoted${qs ? `?${qs}` : ""}`,
  );
  return apiEvents;
}

/**
 * Fetch a single event by ID from the backend API (full details for edit form).
 */
export async function fetchEventById(id: number): Promise<Event> {
  return api.get<ApiEventPublicResponse>(`/events/${id}`);
}

export async function createEventAPI(eventData: EventFormData): Promise<Event> {
  // Re-throw backend errors so callers can display real error messages.
  // Local fabrication of persisted resources is never correct.
  return api.post<ApiEventResponse>("/events/", buildEventPayload(eventData));
}

export async function updateEventAPI(
  eventId: number,
  eventData: EventFormData,
): Promise<Event> {
  return api.patch<ApiEventResponse>(`/events/${eventId}`, buildEventPayload(eventData));
}

export async function deleteEventAPI(eventId: number): Promise<void> {
  await api.delete(`/events/${eventId}`);
}

export function toggleSaveEventAPI(eventId: number, currentSavedIds: number[]): number[] {
  return currentSavedIds.includes(eventId)
    ? currentSavedIds.filter((id) => id !== eventId)
    : [...currentSavedIds, eventId];
}

// --- Backend-synced saved events ---

export async function fetchSavedEventIdsFromBackend(): Promise<number[]> {
  return api.get<number[]>("/saved-events/");
}

export async function saveEventToBackend(eventId: number): Promise<void> {
  await api.put<void>(`/saved-events/${eventId}`);
}

export async function unsaveEventFromBackend(eventId: number): Promise<void> {
  await api.delete(`/saved-events/${eventId}`);
}

export async function reportEventToBackend(eventId: number, reason: string): Promise<void> {
  await api.post("/reports/", { event_id: eventId, reason });
}

export async function sendEventEmailNotification(eventId: number): Promise<boolean> {
  const response = await api.post<{ sent: boolean }>(`/events/${eventId}/email-notification`);
  return response.sent;
}
