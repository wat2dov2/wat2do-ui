/**
 * Admin API
 * Handles all admin-related data operations via the backend.
 */

import type { Event, ReportedEvent, Club, ReportStatus } from "@/shared/types";
import { fetchAllEvents, fetchEventById } from "@/features/events";
import {
  getAllClubs as getAllClubsData,
  getClubTypes as getClubTypesData,
  filterClubs as filterClubsData,
  createClubAPI,
  updateClubAPI,
  deleteClubAPI,
} from "@/features/clubs";
import { api, ApiError, getPaginatedItems } from "@/shared/services/apiClient";

// Re-export types for convenience
export type { ReportedEvent };

// ── Backend response shapes (derived from OpenAPI spec) ─────────────
import type { ApiReportResponse } from "@/shared/generated";

type ReportResponse = ApiReportResponse;

// ── Mappers ─────────────────────────────────────────────────────────

function toReportedEvent(row: ReportResponse): ReportedEvent {
  return {
    id: row.id,
    eventId: row.event_id,
    reportedBy: row.user_id,
    reportedAt: row.reported_at,
    reason: row.reason,
    status: row.status as ReportedEvent["status"],
  };
}

// ── Events API ──────────────────────────────────────────────────────

export async function getAllEvents(): Promise<Event[]> {
  return fetchAllEvents();
}

export async function getEventById(id: number): Promise<Event | null> {
  try {
    return await fetchEventById(id);
  } catch (err) {
    // Only treat 404 as "not found" — propagate other errors (500, 401, etc.)
    // so real outages surface instead of masquerading as a missing record.
    if (err instanceof ApiError && err.status === 404) {
      console.warn(`Event ${id} not found:`, err);
      return null;
    }
    console.error(`Failed to fetch event ${id}:`, err);
    throw err;
  }
}

export { createClubAPI as adminCreateClub, updateClubAPI as adminUpdateClub, deleteClubAPI as adminDeleteClub };

// ── Reported Events API ─────────────────────────────────────────────

export async function getReportedEvents(): Promise<ReportedEvent[]> {
  const rows = await getPaginatedItems<ReportResponse>("/reports/");
  return rows.map(toReportedEvent);
}

export async function getReportedEventsByStatus(
  status: ReportStatus,
): Promise<ReportedEvent[]> {
  const rows = await getPaginatedItems<ReportResponse>(`/reports/?report_status=${status}`);
  return rows.map(toReportedEvent);
}

export async function saveReportedEvent(report: { eventId: number; reason: string }): Promise<void> {
  await api.post("/reports/", { event_id: report.eventId, reason: report.reason });
}

export async function updateReportedEventStatus(
  id: string,
  status: ReportStatus,
): Promise<void> {
  await api.patch(`/reports/${id}`, { status });
}


// ── Admin Clubs API ─────────────────────────────────────────────────

export async function loadAdminClubsData(): Promise<{
  clubs: Club[];
  clubTypes: string[];
}> {
  const [clubs, clubTypes] = await Promise.all([
    getAllClubsData(),
    getClubTypesData(),
  ]);
  return { clubs, clubTypes };
}

export async function filterAdminClubs(
  clubs: Club[],
  options: {
    searchQuery?: string;
    clubType?: string;
  },
): Promise<Club[]> {
  return filterClubsData(clubs, {
    searchQuery: options.searchQuery,
    clubType: options.clubType,
  });
}

// ── Admin Events filtering (pure logic, operates on fetched data) ───

export function filterAdminEvents(
  events: Event[],
  filters: {
    searchQuery?: string;
    selectedCategory?: string;
    showReportedOnly?: boolean;
    reportedEventIds?: Set<number>;
  },
): Event[] {
  let filtered = events;

  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (event) =>
        event.title.toLowerCase().includes(query) ||
        (event.organization ?? "").toLowerCase().includes(query),
    );
  }

  if (filters.selectedCategory) {
    filtered = filtered.filter(
      (event) => event.category === filters.selectedCategory,
    );
  }

  if (filters.showReportedOnly && filters.reportedEventIds) {
    filtered = filtered.filter((event) => filters.reportedEventIds!.has(event.id));
  }

  return filtered;
}

export function getEventCategories(events: Event[]): string[] {
  const categories = new Set<string>();
  events.forEach((event) => {
    if (event.category) categories.add(event.category);
  });
  return Array.from(categories).sort();
}
