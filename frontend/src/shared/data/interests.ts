/**
 * Available user interests.
 *
 * `getAvailableInterests()` returns the live list fetched from the
 * backend at app init via /meta/constants.
 */

import { getAppConstants } from "@/shared/api/metaApi";

export function getAvailableInterests(): string[] {
  return getAppConstants().interests;
}
