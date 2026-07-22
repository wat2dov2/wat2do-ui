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
 * Filter organizations by whether they are affiliated with their school's
 * student association.
 */
export function filterOrganizationsByAffiliation(
  organizations: Organization[],
  associationAffiliated: boolean,
): Organization[] {
  return organizations.filter((org) => Boolean(org.association_affiliated) === associationAffiliated);
}
