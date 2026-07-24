/**
 * Organization Service
 * Handles organization filtering and helper operations
 */

import type { Organization } from "@/shared/types";

/**
 * Filter organizations by search query
 */
export function filterOrganizationsBySearch(organizations: Organization[], searchQuery: string): Organization[] {
  if (!searchQuery.trim()) {
    return organizations;
  }
  const query = searchQuery.toLowerCase();
  return organizations.filter((org) =>
    org.organization_name.toLowerCase().includes(query)
  );
}

/**
 * Filter organizations by category
 */
export function filterOrganizationsByCategory(
  organizations: Organization[],
  categories: string[]
): Organization[] {
  if (categories.length === 0) {
    return organizations;
  }
  return organizations.filter((org) =>
    org.categories.some((cat) => categories.includes(cat))
  );
}

/**
 * Filter organizations by their exact database organization type.
 */
export function filterOrganizationsByType(
  organizations: Organization[],
  organizationType: string,
): Organization[] {
  return organizations.filter((org) => org.organization_type === organizationType);
}
