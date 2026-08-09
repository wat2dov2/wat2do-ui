import type { Organization } from "@/shared/types";

export function isOrganizationIndexable(organization: Organization): boolean {
  return Boolean(
    organization.status === "approved" &&
      organization.organization_name.trim() &&
      organization.school.trim() &&
      (organization.categories.length > 0 ||
        organization.organization_page.trim() ||
        organization.ig ||
        organization.discord ||
        (organization.event_count ?? 0) > 0 ||
        (organization.position_count ?? 0) > 0),
  );
}
