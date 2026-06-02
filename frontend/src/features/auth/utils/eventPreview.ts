/**
 * Shared mapper: Event -> PreviewEventData for auth hero panel and onboarding grid.
 */

import type { Event } from "@/shared/types";
import type { TFunction } from "i18next";
import type { PreviewEventData } from "@/features/auth/components/PreviewStyleEventCard";
import { formatCardDate, formatCardTime } from "@/shared/utils/date";
import { getEventCategory } from "@/shared/utils/event";
import { computeEventBadges } from "@/features/events";

const AUTH_BADGE_STYLES = {
  freeBg: "bg-success/20",
  freeText: "text-success",
  foodBg: "bg-warning/20",
  foodText: "text-warning",
  registrationLabel: undefined as string | undefined,
};

export function eventToPreview(event: Event, locale: string, t: TFunction): PreviewEventData {
  const overrides = { ...AUTH_BADGE_STYLES, registrationLabel: t("common.registration") };
  const badges = computeEventBadges(event, t, overrides);

  return {
    title: event.title,
    org: event.organization || "",
    category: getEventCategory(event),
    image: event.source_image_url ?? "",
    date: formatCardDate(event, locale),
    time: formatCardTime(event),
    location: event.location ?? "",
    badges,
  };
}
