/**
 * Organization category helpers backed by /meta/constants.
 *
 * Call after app init (main.tsx awaits loadAppConstants).
 */

import { getAppConstants } from "@/shared/api/metaApi";

export function getOrganizationCategories(): string[] {
  return getAppConstants().organization_categories;
}
