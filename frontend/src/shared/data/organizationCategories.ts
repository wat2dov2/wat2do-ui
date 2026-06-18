/**
 * Organization category helpers backed by /meta/constants.
 *
 * Uses fallback constants immediately, then backend-hydrated constants once
 * loadAppConstants() completes.
 */

import { getAppConstants } from "@/shared/api/metaApi";

export function getOrganizationCategories(): string[] {
  return getAppConstants().organization_categories;
}
