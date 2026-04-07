/**
 * Centralized URL query parameter names.
 *
 * Every search-param key used across the app lives here so that renaming a
 * param only requires a single-line change.  Import individual keys or the
 * whole object:
 *
 *   import { QP } from "@/shared/constants/queryParams";
 *   searchParams.get(QP.EVENT_ID);
 */

export const QP = {
  /** Identifies a specific event (numeric id as string) */
  EVENT_ID: "eventId",

  /** Identifies a specific submission (uuid string) */
  SUBMISSION_ID: "submissionId",

  /** Identifies a specific QR-code / poster (uuid string) */
  QR_CODE_ID: "qrCodeId",

  /** JSON-encoded FilterState blob */
  FILTERS: "filters",

  /** Overrides the initial page/mode on first load */
  PAGE_MODE: "pageMode",

  /** Settings page tab selection */
  TAB: "tab",
} as const;
