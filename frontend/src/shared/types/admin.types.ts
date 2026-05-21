/**
 * Admin-related types
 *
 * Status unions are derived from the constants in shared/constants/statuses.ts
 * which mirror the backend Literal types (schemas/report.py).
 *
 * At runtime, the canonical list is fetched via /meta/constants
 * (see shared/api/metaApi.ts). These TypeScript types exist for
 * compile-time safety; the backend is the source of truth.
 */

import type { REPORT_STATUSES } from "@/shared/constants/statuses";

/** Derived from REPORT_STATUSES constant tuple */
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportedEvent {
  id: string;
  eventId: number;
  reportedBy: string;
  reportedAt: string;
  reason: string;
  status: ReportStatus;
}
