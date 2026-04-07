/**
 * Admin API
 * Handles all admin-related data operations via the backend.
 */

import type { Event, EventSubmission, ReportedEvent, ScrapedEvent, Club } from "@/shared/types";
import { fetchAllEvents } from "@/features/events/api/events.api";
import {
  getAllClubs as getAllClubsData,
  getClubTypes as getClubTypesData,
  filterClubs as filterClubsData,
  createClubAPI,
  updateClubAPI,
  deleteClubAPI,
} from "@/features/clubs/api/clubs.api";
import { api } from "@/shared/services/apiClient";

// Re-export types for convenience
export type { EventSubmission, ReportedEvent, ScrapedEvent };

// ── Backend response shapes (derived from OpenAPI spec) ─────────────
import type {
  ApiSubmissionResponse,
  ApiReportResponse,
  ApiScrapedEventResponse,
} from "@/shared/generated";

type SubmissionResponse = ApiSubmissionResponse;
type ReportResponse = ApiReportResponse;
type ScrapedEventResponse = ApiScrapedEventResponse;

// ── Mappers ─────────────────────────────────────────────────────────

function toEventSubmission(row: SubmissionResponse): EventSubmission {
  return {
    id: row.id,
    eventData: row.event_data as EventSubmission["eventData"],
    submittedBy: row.user_id,
    submittedAt: row.submitted_at,
    status: row.status as EventSubmission["status"],
    rejectionReason: row.rejection_reason ?? undefined,
  };
}

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

function toScrapedEvent(row: ScrapedEventResponse): ScrapedEvent {
  return {
    id: row.id,
    eventId: row.event_id ?? 0,
    scrapedAt: row.scraped_at,
    source: row.source,
  };
}

// ── Events API ──────────────────────────────────────────────────────

export async function getAllEvents(): Promise<Event[]> {
  return fetchAllEvents();
}

export async function getEventById(id: number): Promise<Event | null> {
  const events = await getAllEvents();
  return events.find((e) => e.id === id) || null;
}

export { createClubAPI as adminCreateClub, updateClubAPI as adminUpdateClub, deleteClubAPI as adminDeleteClub };

// ── Reported Events API ─────────────────────────────────────────────

export async function getReportedEvents(): Promise<ReportedEvent[]> {
  const rows = await api.get<ReportResponse[]>("/reports/");
  return rows.map(toReportedEvent);
}

export async function getReportedEventsByStatus(
  status: "pending" | "resolved" | "dismissed",
): Promise<ReportedEvent[]> {
  const rows = await api.get<ReportResponse[]>(`/reports/?report_status=${status}`);
  return rows.map(toReportedEvent);
}

export async function saveReportedEvent(report: { eventId: number; reason: string }): Promise<void> {
  await api.post("/reports/", { event_id: report.eventId, reason: report.reason });
}

export async function updateReportedEventStatus(
  id: string,
  status: "pending" | "resolved" | "dismissed",
): Promise<void> {
  await api.patch(`/reports/${id}`, { status });
}

// ── Event Submissions API ───────────────────────────────────────────

export async function getEventSubmissions(): Promise<EventSubmission[]> {
  const rows = await api.get<SubmissionResponse[]>("/submissions/");
  return rows.map(toEventSubmission);
}

export async function getSubmissionById(id: string): Promise<EventSubmission | null> {
  try {
    const row = await api.get<SubmissionResponse>(`/submissions/${id}`);
    return toEventSubmission(row);
  } catch {
    return null;
  }
}

export async function getSubmissionsByStatus(
  status: "pending" | "approved" | "rejected",
): Promise<EventSubmission[]> {
  const rows = await api.get<SubmissionResponse[]>(`/submissions/?submission_status=${status}`);
  return rows.map(toEventSubmission);
}

export async function saveEventSubmission(eventData: Record<string, unknown>): Promise<void> {
  await api.post("/submissions/", { event_data: eventData });
}

export async function updateEventSubmission(
  id: string,
  status: "pending" | "approved" | "rejected",
  rejectionReason?: string,
): Promise<void> {
  await api.patch(`/submissions/${id}`, {
    status,
    rejection_reason: rejectionReason ?? null,
  });
}

export async function approveSubmission(id: string): Promise<void> {
  await updateEventSubmission(id, "approved");
}

export async function rejectSubmission(id: string, rejectionReason: string): Promise<void> {
  await updateEventSubmission(id, "rejected", rejectionReason);
}

export async function updateSubmissionStatus(
  id: string,
  status: "pending" | "approved" | "rejected",
  rejectionReason?: string,
): Promise<void> {
  await updateEventSubmission(id, status, rejectionReason);
}

export async function deleteSubmission(id: string): Promise<void> {
  await api.delete(`/submissions/${id}`);
}

// ── Scraped Events API ──────────────────────────────────────────────

export async function getScrapedEvents(): Promise<ScrapedEvent[]> {
  const rows = await api.get<ScrapedEventResponse[]>("/scraped-events/");
  return rows.map(toScrapedEvent);
}

export async function saveScrapedEvent(scraped: { eventId?: number; source: string }): Promise<void> {
  await api.post("/scraped-events/", {
    event_id: scraped.eventId ?? null,
    source: scraped.source,
  });
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
