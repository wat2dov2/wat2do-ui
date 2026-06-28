import type { TFunction } from "i18next";
import { formatRelativeTime } from "@/shared/utils/relativeTime";
import type { Organization } from "@/shared/types";

export function formatOrganizationLastPosted(
  organization: Organization,
  t: TFunction,
): string | undefined {
  if (!organization.latest_event_added_at || !organization.latest_event_title) {
    return undefined;
  }

  return t("organizations.lastPostedSummary", {
    time: formatRelativeTime(organization.latest_event_added_at, t),
    title: organization.latest_event_title,
  });
}

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
