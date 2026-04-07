/**
 * Available user interests.
 *
 * `getAvailableInterests()` returns the live list fetched from the
 * backend at app init via /meta/constants.
 *
 * The static `availableInterests` is kept as a fallback and for
 * backwards compatibility with existing consumers.
 */

import { getAppConstants, FALLBACK_INTERESTS } from "@/shared/api/metaApi";

/**
 * Runtime interest list from the backend.
 * Falls back to compiled defaults if the fetch hasn't completed.
 */
export function getAvailableInterests(): string[] {
  return getAppConstants().interests;
}

/**
 * Static export for existing consumers.
 * Prefer `getAvailableInterests()` in new code.
 */
export const availableInterests: string[] = [...FALLBACK_INTERESTS];
