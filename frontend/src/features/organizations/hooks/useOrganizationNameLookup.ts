import { useCallback, useMemo } from "react";
import type { Organization } from "@/shared/types";
import { getAllOrganizations } from "@/features/organizations/api/organizations.api";
import { useBackendQuery } from "@/shared/hooks/useBackendQuery";

const NO_ORGANIZATIONS: Organization[] = [];

/**
 * Resolve an organization id to its display name. Loads the full organization list once and
 * exposes a stable lookup — the single source of truth for showing the organization
 * name of an event/submission that only carries a organization_id.
 */
export function useOrganizationNameLookup() {
  const { data: organizations } = useBackendQuery(getAllOrganizations, NO_ORGANIZATIONS);

  const namesById = useMemo(() => {
    const map = new Map<number, string>();
    organizations.forEach((org) => map.set(org.id, org.organization_name));
    return map;
  }, [organizations]);

  const getOrganizationName = useCallback(
    (organizationId: number | null | undefined): string =>
      organizationId != null ? namesById.get(organizationId) ?? "" : "",
    [namesById],
  );

  return { getOrganizationName: getOrganizationName };
}
