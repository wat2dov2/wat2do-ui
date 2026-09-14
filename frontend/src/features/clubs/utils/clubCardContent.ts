import type { TFunction } from "i18next";
import type { Club } from "@/shared/types";

export function getClubCountBadges(
  club: Club,
  t: TFunction,
): Array<{ text: string }> {
  const eventCount = club.event_count ?? 0;
  const positionCount = club.position_count ?? 0;

  return [
    ...(eventCount > 0
      ? [{ text: t("clubs.eventCount", { count: eventCount }) }]
      : []),
    ...(positionCount > 0
      ? [{ text: t("clubs.positionCount", { count: positionCount }) }]
      : []),
  ];
}

export function getClubSocialHandle(
  club: Club,
): string | undefined {
  if (club.ig) {
    return `@${club.ig}`;
  }
  return undefined;
}
