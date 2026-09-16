/**
 * Status unions derived from shared/constants/statuses.ts (mirrors backend
 * Literals). Runtime lists come from /meta/constants; these types are for
 * compile-time safety.
 */

import type { REPORT_STATUSES, SUBMISSION_STATUSES } from "@/shared/constants/statuses";
import type { ApiEventCreate } from "@/shared/generated";

/** Derived from REPORT_STATUSES constant tuple */
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportedEvent {
  eventTitle?: string | null;
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
  clubName?: string | null;
  school?: string | null;
  id: string;
  eventData: ApiEventCreate;
  submittedBy: string;
  submittedAt: string;
  status: SubmissionStatus;
  rejectionReason?: string;
}
