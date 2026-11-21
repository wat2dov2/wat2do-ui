import partnersControl from "../../../../../backend/controlbox/partners.json" with { type: "json" };
import { eventPagePath } from "@/features/events/lib/eventUrls";
import type { Event } from "@/shared/types";
import {
  getPrimaryOccurrence,
  isActiveOrUpcomingOccurrence,
  type Occurrence,
} from "@/shared/utils/date";
import { instagramPostUrl } from "@/shared/utils/url";

const BANNER_LEAD_MS = partnersControl.banner_lead_days * 24 * 60 * 60 * 1000;

/** Where a partner event's banner links: the partner's Instagram post about it, else its page here. */
export interface PartnerEventLink {
  kind: "instagramPost" | "eventPage";
  href: string;
}

/** A partner business's next event at a school, as that school's site banner promotes it. */
export interface PartnerEventBanner {
  partnerName: string;
  discountPercent: number;
  discountCode: string;
  /** Where the partner's name and the call to action go. */
  link: PartnerEventLink;
  /** The venue's own name, or null when the event names none to show. */
  venue: string | null;
  /** The date the banner announces: the one on now, else the event's next. */
  occurrence: Occurrence;
}

/** The businesses with a deal at `school` (backend/controlbox/partners.json), by Instagram handle. */
function partnersAt(school: string) {
  return new Map(
    partnersControl.partners
      .filter((partner) => partner.schools.includes(school))
      .map((partner) => [partner.instagram_handle, partner]),
  );
}

export function hasPartnersAt(school: string): boolean {
  return partnersAt(school).size > 0;
}

/**
 * The venue alone: the first part of the event's map location, which names the
 * venue before its address (backend/services/ingestion/prompt.md). A map
 * location that starts with a street number names no venue, and an online or
 * unannounced one has none.
 */
function venueName(mapLocation: string | null | undefined): string | null {
  const venue = mapLocation?.split(",")[0]?.trim();
  return venue && !/^\d/.test(venue) ? venue : null;
}

/**
 * The partner's own Instagram post about the event, which the event was read
 * from, or the event's page here when it came from anywhere else.
 */
function partnerEventLink(event: Event): PartnerEventLink {
  const postUrl = instagramPostUrl(event.source_url);
  return postUrl
    ? { kind: "instagramPost", href: postUrl }
    : { kind: "eventPage", href: eventPagePath(event.id) };
}

/**
 * The partner event a school's banner shows at `now`: of the partners' events in
 * the school's feed, the one on now or starting soonest within
 * `banner_lead_days`, or null when none is.
 */
export function findPartnerEventBanner(
  events: Event[],
  school: string,
  now: number,
): PartnerEventBanner | null {
  const partners = partnersAt(school);
  let next: PartnerEventBanner | null = null;
  for (const event of events) {
    const handle = event.ig_handle?.trim().replace(/^@/, "").toLowerCase();
    const partner = handle ? partners.get(handle) : undefined;
    if (!partner || event.cancelled) continue;
    const occurrence = getPrimaryOccurrence(event, new Date(now));
    if (!occurrence || !isActiveOrUpcomingOccurrence(occurrence, now)) continue;
    const startMs = new Date(occurrence.dtstart_utc).getTime();
    if (startMs > now + BANNER_LEAD_MS) continue;
    if (next && new Date(next.occurrence.dtstart_utc).getTime() <= startMs) continue;
    next = {
      partnerName: partner.name,
      discountPercent: partner.discount_percent,
      discountCode: partner.discount_code,
      link: partnerEventLink(event),
      venue: venueName(event.map_location),
      occurrence: { dtstart_utc: occurrence.dtstart_utc, dtend_utc: occurrence.dtend_utc },
    };
  }
  return next;
}
