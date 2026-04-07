/**
 * Admin-related types
 *
 * Status unions must match the backend Literal types:
 *   SubmissionStatus → schemas/submission.py
 *   ReportStatus     → schemas/report.py
 *
 * At runtime, the canonical list is fetched via /meta/constants
 * (see shared/api/metaApi.ts). These TypeScript types exist for
 * compile-time safety; the backend is the source of truth.
 */

import type { EventFormData } from "@/shared/types/event.types";

/** Must match backend SubmissionStatus = Literal["pending","approved","rejected"] */
export type SubmissionStatus = "pending" | "approved" | "rejected";

/** Must match backend ReportStatus = Literal["pending","resolved","dismissed"] */
export type ReportStatus = "pending" | "resolved" | "dismissed";

// Admin panel types
export interface EventSubmission {
  id: string;
  eventData: EventFormData;
  submittedBy: string; // user email
  submittedAt: string; // ISO timestamp
  status: SubmissionStatus;
  rejectionReason?: string; // Reason provided when rejecting
}

export interface ReportedEvent {
  id: string;
  eventId: number;
  reportedBy: string;
  reportedAt: string;
  reason: string;
  status: ReportStatus;
}

export interface ScrapedEvent {
  id: string;
  eventId: number;
  scrapedAt: string;
  source: string; // e.g., "web-scraper"
}

// Union type for activity feed
export type AdminActivity =
  | { type: "submission"; data: EventSubmission }
  | { type: "scraped"; data: ScrapedEvent }
  | { type: "reported"; data: ReportedEvent };
