/**
 * Centralized URL query parameter names.
 *
 * Every search-param key used across the app lives here so that renaming a
 * param only requires a single-line change.  Import individual keys or the
 * whole object:
 *
 *   import { QP } from "@/shared/constants/queryParams";
 *   searchParams.get(QP.SUBMISSION_ID);
 */

export const QP = {
  /** Identifies a specific event submission (uuid string) */
  SUBMISSION_ID: "submissionId",

  /** Identifies a specific QR-code / poster (uuid string) */
  QR_CODE_ID: "qrCodeId",

  /** Identifies a poster in campaign landing and dashboard links */
  POSTER_ID: "poster_id",

  /** UTM source used to identify poster-driven event landings */
  UTM_SOURCE: "utm_source",

  /** Initial school selection for auth redirects / deep links */
  SCHOOL: "school",

  /** Same-origin path restored after sign-in and onboarding */
  RETURN_TO: "returnTo",

  /** Overrides the initial page/mode on first load */
  PAGE_MODE: "pageMode",

  /** Settings page tab selection */
  TAB: "tab",
} as const;
