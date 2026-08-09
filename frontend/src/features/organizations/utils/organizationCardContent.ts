import type { TFunction } from "i18next";
import type { Organization } from "@/shared/types";

export function getOrganizationCountBadges(
  organization: Organization,
  t: TFunction,
): Array<{ text: string }> {
  const eventCount = organization.event_count ?? 0;
  const positionCount = organization.position_count ?? 0;

  return [
    ...(eventCount > 0
      ? [{ text: t("organizations.eventCount", { count: eventCount }) }]
      : []),
    ...(positionCount > 0
      ? [{ text: t("organizations.positionCount", { count: positionCount }) }]
      : []),
  ];
}

export function getOrganizationSocialHandle(
  organization: Organization,
): string | undefined {
  if (organization.ig) {
    return `@${organization.ig}`;
  }
  return undefined;
}
