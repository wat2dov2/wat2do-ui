/**
 * Admin API
 * Handles all admin-related data operations
 * 
 * This is the public API for the admin feature.
 * It provides clean interfaces for managing admin data.
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
import { StorageService } from "@/shared/services/storageService";

// Re-export types for convenience
export type { EventSubmission, ReportedEvent, ScrapedEvent };

/**
 * Events API
 */

/**
 * Get all events from backend
 */
export async function getAllEvents(): Promise<Event[]> {
  return fetchAllEvents();
}

/**
 * Get event by ID
 */
export async function getEventById(id: number): Promise<Event | null> {
  const events = await getAllEvents();
  return events.find((e) => e.id === id) || null;
}

export { createClubAPI as adminCreateClub, updateClubAPI as adminUpdateClub, deleteClubAPI as adminDeleteClub };

/**
 * Reported Events API
 */

/**
 * Get all reported events
 */
export function getReportedEvents(): ReportedEvent[] {
  const stored = StorageService.getItem<string | null>(
    STORAGE_KEYS.REPORTED_EVENTS,
    null
  );
  const userReports: ReportedEvent[] = stored ? JSON.parse(stored) : [];
  return userReports;
}

/**
 * Get reported events by status
 */
export function getReportedEventsByStatus(
  status: "pending" | "resolved" | "dismissed"
): ReportedEvent[] {
  const reports = getReportedEvents();
  return reports.filter((r) => r.status === status);
}

/**
 * Save reported event
 */
export function saveReportedEvent(report: ReportedEvent): void {
  const stored = StorageService.getItem<string | null>(
    STORAGE_KEYS.REPORTED_EVENTS,
    null
  );
  const reports: ReportedEvent[] = stored ? JSON.parse(stored) : [];
  reports.push(report);
  StorageService.setItem(STORAGE_KEYS.REPORTED_EVENTS, JSON.stringify(reports));
}

/**
 * Update reported event status
 */
export function updateReportedEventStatus(
  id: string,
  status: "pending" | "resolved" | "dismissed"
): void {
  const stored = StorageService.getItem<string | null>(
    STORAGE_KEYS.REPORTED_EVENTS,
    null
  );
  const reports: ReportedEvent[] = stored ? JSON.parse(stored) : [];
  const index = reports.findIndex((r) => r.id === id);
  if (index !== -1) {
    reports[index].status = status;
    StorageService.setItem(STORAGE_KEYS.REPORTED_EVENTS, JSON.stringify(reports));
  }
}

/**
 * Event Submissions API
 */

const STORAGE_KEYS = {
  EVENT_SUBMISSIONS: "eventSubmissions",
  REPORTED_EVENTS: "reportedEvents",
  SCRAPED_EVENTS: "scrapedEvents",
} as const;

/**
 * Get all event submissions
 */
export function getEventSubmissions(): EventSubmission[] {
  const stored = StorageService.getItem<string | null>(
    STORAGE_KEYS.EVENT_SUBMISSIONS,
    null
  );
  const userSubmissions: EventSubmission[] = stored ? JSON.parse(stored) : [];
  return userSubmissions;
}

/**
 * Get submission by ID
 */
export function getSubmissionById(id: string): EventSubmission | null {
  const submissions = getEventSubmissions();
  return submissions.find((s) => s.id === id) || null;
}

/**
 * Get submissions by status
 */
export function getSubmissionsByStatus(
  status: "pending" | "approved" | "rejected"
): EventSubmission[] {
  const submissions = getEventSubmissions();
  return submissions.filter((s) => s.status === status);
}

/**
 * Save event submission
 */
export function saveEventSubmission(submission: EventSubmission): void {
  const stored = StorageService.getItem<string | null>(
    STORAGE_KEYS.EVENT_SUBMISSIONS,
    null
  );
  const submissions: EventSubmission[] = stored ? JSON.parse(stored) : [];
  submissions.push(submission);
  StorageService.setItem(STORAGE_KEYS.EVENT_SUBMISSIONS, JSON.stringify(submissions));
}

/**
 * Update event submission status
 */
export function updateEventSubmission(
  id: string,
  status: "pending" | "approved" | "rejected",
  rejectionReason?: string
): void {
  const stored = StorageService.getItem<string | null>(
    STORAGE_KEYS.EVENT_SUBMISSIONS,
    null
  );
  const submissions: EventSubmission[] = stored ? JSON.parse(stored) : [];
  const index = submissions.findIndex((s) => s.id === id);
  if (index !== -1) {
    submissions[index].status = status;
    if (status === "rejected" && rejectionReason) {
      submissions[index].rejectionReason = rejectionReason;
    }
    StorageService.setItem(STORAGE_KEYS.EVENT_SUBMISSIONS, JSON.stringify(submissions));
  }
}

/**
 * Approve a submission
 */
export function approveSubmission(id: string): void {
  updateEventSubmission(id, "approved");
}

/**
 * Reject a submission
 */
export function rejectSubmission(
  id: string,
  rejectionReason: string
): void {
  updateEventSubmission(id, "rejected", rejectionReason);
}

/**
 * Update submission status
 */
export function updateSubmissionStatus(
  id: string,
  status: "pending" | "approved" | "rejected",
  rejectionReason?: string
): void {
  updateEventSubmission(id, status, rejectionReason);
}

/**
 * Delete a submission
 */
export function deleteSubmission(id: string): void {
  const stored = StorageService.getItem<string | null>(
    STORAGE_KEYS.EVENT_SUBMISSIONS,
    null
  );
  const submissions: EventSubmission[] = stored ? JSON.parse(stored) : [];
  const filtered = submissions.filter((s) => s.id !== id);
  StorageService.setItem(STORAGE_KEYS.EVENT_SUBMISSIONS, JSON.stringify(filtered));
}

/**
 * Scraped Events API
 */

/**
 * Get all scraped events
 */
export function getScrapedEvents(): ScrapedEvent[] {
  // Migrate old "scrappedEvents" to "scrapedEvents"
  const oldStored = StorageService.getItem<string | null>("scrappedEvents", null);
  if (oldStored) {
    try {
      const oldData = JSON.parse(oldStored);
      // Convert old format to new format
      const migrated: ScrapedEvent[] = oldData.map((item: Record<string, unknown>) => ({
        ...item,
        scrapedAt: (item.scrappedAt || item.scrapedAt) as string,
      })) as ScrapedEvent[];
      StorageService.setItem(STORAGE_KEYS.SCRAPED_EVENTS, JSON.stringify(migrated));
      StorageService.removeItem("scrappedEvents");
    } catch {
      // If migration fails, just remove old data
      StorageService.removeItem("scrappedEvents");
    }
  }
  
  const stored = StorageService.getItem<string | null>(
    STORAGE_KEYS.SCRAPED_EVENTS,
    null
  );
  const userScraped: ScrapedEvent[] = stored ? JSON.parse(stored) : [];
  return userScraped;
}

/**
 * Save scraped event
 */
export function saveScrapedEvent(scraped: ScrapedEvent): void {
  const stored = StorageService.getItem<string | null>(
    STORAGE_KEYS.SCRAPED_EVENTS,
    null
  );
  const scrapedEvents: ScrapedEvent[] = stored ? JSON.parse(stored) : [];
  scrapedEvents.push(scraped);
  StorageService.setItem(STORAGE_KEYS.SCRAPED_EVENTS, JSON.stringify(scrapedEvents));
}

/**
 * QR Codes: use listPostersFromBackend, getScansFromBackend, deletePosterFromBackend
 * from @/features/qrcode/api/qrcode.api (or useBackendPosters / useBackendScans hooks).
 */

/**
 * Admin Clubs API
 * Wraps clubs functions for admin use
 */

/**
 * Load all clubs and club types for admin
 */
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

/**
 * Filter clubs for admin page
 */
export async function filterAdminClubs(
  clubs: Club[],
  options: {
    searchQuery?: string;
    clubType?: string;
  }
): Promise<Club[]> {
  return filterClubsData(clubs, {
    searchQuery: options.searchQuery,
    clubType: options.clubType,
  });
}

/**
 * Admin Events API
 * Filtering and querying functions for admin events page
 */

/**
 * Filter events for admin page
 */
export function filterAdminEvents(
  events: Event[],
  filters: {
    searchQuery?: string;
    selectedCategory?: string;
    showReportedOnly?: boolean;
  }
): Event[] {
  let filtered = events;

  // Search filter
  if (filters.searchQuery) {
    const query = filters.searchQuery.toLowerCase();
    filtered = filtered.filter(
      (event) =>
        event.title.toLowerCase().includes(query) ||
        (event.organization ?? "").toLowerCase().includes(query)
    );
  }

  // Category filter
  if (filters.selectedCategory) {
    filtered = filtered.filter(
      (event) => event.category === filters.selectedCategory
    );
  }

  // Reported events filter
  if (filters.showReportedOnly) {
    const reportedEvents = getReportedEvents().filter(
      (r) => r.status === "pending"
    );
    const reportedIds = new Set(reportedEvents.map((r) => r.eventId));
    filtered = filtered.filter((event) => reportedIds.has(event.id));
  }

  return filtered;
}

/**
 * Get unique categories from events
 */
export function getEventCategories(events: Event[]): string[] {
  const categories = new Set<string>();
  events.forEach((event) => { if (event.category) categories.add(event.category); });
  return Array.from(categories).sort();
}

/**
 * Check if an event is reported
 */
export function isEventReported(eventId: number): boolean {
  const reportedEvents = getReportedEvents().filter(
    (r) => r.status === "pending"
  );
  return reportedEvents.some((r) => r.eventId === eventId);
}
