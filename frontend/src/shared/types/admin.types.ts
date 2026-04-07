/**
 * Admin-related types
 *
 * Status unions are derived from the constants in shared/constants/statuses.ts
 * which mirror the backend Literal types (schemas/submission.py, schemas/report.py).
 *
 * At runtime, the canonical list is fetched via /meta/constants
 * (see shared/api/metaApi.ts). These TypeScript types exist for
 * compile-time safety; the backend is the source of truth.
 */

import type { EventFormData } from "@/shared/types/event.types";
import type { SUBMISSION_STATUSES, REPORT_STATUSES } from "@/shared/constants/statuses";

/** Derived from SUBMISSION_STATUSES constant tuple */
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Derived from REPORT_STATUSES constant tuple */
export type ReportStatus = (typeof REPORT_STATUSES)[number];

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
