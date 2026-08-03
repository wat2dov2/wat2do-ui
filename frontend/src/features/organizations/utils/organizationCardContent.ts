import type { TFunction } from "i18next";
import type { Organization } from "@/shared/types";

export function getOrganizationEventCountBadge(
  organization: Organization,
  t: TFunction,
): Array<{ text: string }> {
  const count = organization.event_count ?? 0;
  if (count <= 0) {
    return [];
  }

  return [{ text: t("organizations.eventCount", { count }) }];
}

export function getOrganizationSocialHandle(organization: Organization): string | undefined {
  if (organization.ig) {
    return `@${organization.ig}`;
  }
  return undefined;
}
