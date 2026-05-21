/**
 * Status constants for reports.
 *
 * Single source of truth for status string values used across
 * admin features. The backend exposes matching values via
 * /meta/constants; these compile-time constants let us avoid
 * scattering raw strings through components, hooks, and API calls.
 */

// -- Report statuses -------------------------------------------------------
export const REPORT_PENDING = "pending" as const;
const REPORT_RESOLVED = "resolved" as const;
const REPORT_DISMISSED = "dismissed" as const;

export const REPORT_STATUSES = [
  REPORT_PENDING,
  REPORT_RESOLVED,
  REPORT_DISMISSED,
] as const;

// -- Event submission statuses ---------------------------------------------
export const SUBMISSION_PENDING = "pending" as const;
export const SUBMISSION_APPROVED = "approved" as const;
export const SUBMISSION_REJECTED = "rejected" as const;

export const SUBMISSION_STATUSES = [
  SUBMISSION_PENDING,
  SUBMISSION_APPROVED,
  SUBMISSION_REJECTED,
] as const;
