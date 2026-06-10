/**
 * Organization category helpers backed by /meta/constants.
 *
 * Call after app init (main.tsx awaits loadAppConstants).
 */

import { getAppConstants } from "@/shared/api/metaApi";

export type OrganizationCategory = string;

export function getOrganizationCategories(): string[] {
  return getAppConstants().organization_categories;
}

export function getDefaultOrganizationCategory(): string {
  const categories = getOrganizationCategories();
  return categories[0] ?? "";
}

export function isOrganizationCategory(value: string): boolean {
  return getOrganizationCategories().includes(value);
}
