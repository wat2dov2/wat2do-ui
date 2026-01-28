/**
 * Admin API
 * Handles all admin-related data operations
 * 
 * This is the public API for the admin feature.
 * It provides clean interfaces for managing admin data.
 */

import type { Event, EventSubmission, ReportedEvent, ScrapedEvent, Club } from "@/shared/types";
import { loadAllEvents } from "@/features/events/api/events.api";
import {
  getAllClubs as getAllClubsData,
  getClubTypes as getClubTypesData,
  filterClubs as filterClubsData,
} from "@/features/clubs/api/clubs.api";
import {
  getQRCodes as getQRCodesData,
  getQRScans as getQRScansData,
  getQRCodeById as getQRCodeByIdData,
  deleteQRCode as deleteQRCodeData,
} from "@/features/qrcode/api/qrcode.api";
import type { QRCode, QRCodeScan } from "@/shared/types";
import { StorageService } from "@/shared/services/storageService";
import {
  mockEventSubmissions,
  mockReportedEvents,
  mockScrapedEvents,
} from "@/features/admin/data/adminData";

// Re-export types for convenience
export type { EventSubmission, ReportedEvent, ScrapedEvent };

/**
 * Events API
 */

/**
 * Get all events
 */
export function getAllEvents(): Event[] {
  return loadAllEvents();
}

/**
 * Get event by ID
 */
export function getEventById(id: number): Event | null {
  const events = getAllEvents();
  return events.find((e) => e.id === id) || null;
}

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
  return [...mockReportedEvents, ...userReports];
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
  // Also update mock data if it exists
  const mockIndex = mockReportedEvents.findIndex((r) => r.id === id);
  if (mockIndex !== -1) {
    mockReportedEvents[mockIndex].status = status;
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
  return [...mockEventSubmissions, ...userSubmissions];
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
  // Also update mock data if it exists
  const mockIndex = mockEventSubmissions.findIndex((s) => s.id === id);
  if (mockIndex !== -1) {
    mockEventSubmissions[mockIndex].status = status;
    if (status === "rejected" && rejectionReason) {
      mockEventSubmissions[mockIndex].rejectionReason = rejectionReason;
    }
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
  // Also remove from mock data if it exists
  const mockIndex = mockEventSubmissions.findIndex((s) => s.id === id);
  if (mockIndex !== -1) {
    mockEventSubmissions.splice(mockIndex, 1);
  }
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
  return [...mockScrapedEvents, ...userScraped];
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
 * QR Codes API (Admin)
 * Wraps QR code functions for admin use
 */

/**
 * Get all QR codes
 */
export function getQRCodes(): QRCode[] {
  return getQRCodesData();
}

/**
 * Get QR code by ID
 */
export function getQRCodeById(id: string): QRCode | null {
  return getQRCodeByIdData(id);
}

/**
 * Get all QR code scans
 */
export function getQRScans(): QRCodeScan[] {
  return getQRScansData();
}

/**
 * Delete QR code
 */
export function deleteQRCode(id: string): void {
  deleteQRCodeData(id);
}

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
        event.organization.toLowerCase().includes(query)
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
  events.forEach((event) => categories.add(event.category));
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
