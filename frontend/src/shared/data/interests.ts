/**
 * Available user interests.
 *
 * `getAvailableInterests()` returns the live list fetched from the
 * backend at app init via /meta/constants. Falls back to compiled
 * defaults if the fetch hasn't completed.
 */

import { getAppConstants } from "@/shared/api/metaApi";

export function getAvailableInterests(): string[] {
  return getAppConstants().interests;
}
