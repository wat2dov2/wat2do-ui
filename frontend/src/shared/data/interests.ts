/**
 * Available user interests.
 *
 * `getAvailableInterests()` returns fallback constants immediately, then
 * backend-hydrated constants once /meta/constants finishes loading.
 */

import { getAppConstants } from "@/shared/api/metaApi";

export function getAvailableInterests(): string[] {
  return getAppConstants().interests;
}
