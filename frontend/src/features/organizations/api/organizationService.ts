/**
 * Organization Service
 * Handles organization filtering and helper operations
 */

import type { ApiOrganizationResponse } from "@/shared/generated";
import type { Organization } from "@/shared/types";

export function normalizeOrganization(
  raw: ApiOrganizationResponse,
): Organization {
  return {
    ...raw,
    categories: raw.categories ?? [],
    organization_page: raw.organization_page ?? "",
    ig: raw.ig ?? null,
    discord: raw.discord ?? null,
    logo_url: raw.logo_url ?? null,
    created_by: raw.created_by ?? null,
    school: raw.school ?? "",
    event_count: raw.event_count ?? 0,
  };
}

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
