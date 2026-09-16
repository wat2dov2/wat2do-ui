/**
 * Shared mapper: Event -> PreviewEventData for auth hero panel and onboarding grid.
 */

import type { Event } from "@/shared/types";
import type { TFunction } from "i18next";
import type { PreviewEventData } from "@/features/auth/components/PreviewStyleEventCard";
import { formatCardDate, formatCardTime, isEventHappeningNow, wasAddedWithinLast24Hours } from "@/shared/utils/date";
import { getEventCategory } from "@/shared/utils/event";
import { computeEventBadges } from "@/features/events/hooks/useEventBadges";

export function eventToPreview(event: Event, timeZone: string, locale: string, t: TFunction): PreviewEventData {
  return {
    title: event.title,
    org: event.club || "",
    category: getEventCategory(event),
    image: event.source_image_url ?? "",
    date: formatCardDate(event, timeZone, locale),
    time: formatCardTime(event, timeZone, locale),
    location: event.location ?? "",
    badges: computeEventBadges(event, t),
    isLive: isEventHappeningNow(event),
    isNew: wasAddedWithinLast24Hours(event),
  };
}
