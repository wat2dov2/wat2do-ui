/**
 * Status unions derived from shared/constants/statuses.ts (mirrors backend
 * Literals). Runtime lists come from /meta/constants; these types are for
 * compile-time safety.
 */

import type { REPORT_STATUSES, SUBMISSION_STATUSES } from "@/shared/constants/statuses";
import type { EventFormData } from "@/shared/types/event.types";

/** Derived from REPORT_STATUSES constant tuple */
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportedEvent {
  school?: string | null;
  id: string;
  eventId: number;
  reportedBy: string | null;
  reportedAt: string;
  reason: string;
  status: ReportStatus;
}

export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export interface EventSubmission {
  school?: string | null;
  id: string;
  eventData: EventFormData;
  submittedBy: string;
  submittedAt: string;
  status: SubmissionStatus;
  rejectionReason?: string;
}
