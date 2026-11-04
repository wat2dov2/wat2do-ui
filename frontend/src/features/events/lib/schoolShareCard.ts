import { createHash } from "node:crypto";
import type { School } from "@/shared/api/schools.api";
import { controlBox } from "@/shared/config/controlBox";
import { getSchoolPublicUrl } from "@/shared/constants/schools";
import { getSchoolColors, type SchoolColors } from "@/shared/lib/schoolBranding";
import { getSchoolCanonicalUrl } from "@/shared/lib/seo";
import type { Event } from "@/shared/types";
import { hasActiveEventOccurrence } from "@/shared/utils/date";

/**
 * Where `src/app/og-image.png/route.tsx` draws a school's link preview. Each
 * school serves it from its own host, which is what picks the school, just as
 * it does for the event feed.
 */
const SCHOOL_SHARE_IMAGE_PATH = "/og-image.png";

/** Everything drawn on a school's link preview, in the school's language. */
export interface SchoolShareCard {
  colors: SchoolColors;
  schoolName: string;
  /** How many listed events have not ended, or what the feed offers when none. */
  eventsLine: string;
  /** The school's own Wat2Do address. */
  siteLine: string;
}

function describeUpcomingEvents(count: number, language: School["language"]): string {
  if (count === 0) {
    return language === "fr" ? "Événements et clubs du campus" : "Campus events and clubs";
  }
  if (language === "fr") {
    return `${count} ${count === 1 ? "événement" : "événements"} à venir`;
  }
  return `${count} upcoming ${count === 1 ? "event" : "events"}`;
}

/** The card for a school's event feed, as of `now`. */
export function buildSchoolShareCard(
  school: School,
  events: Event[],
  now: number,
): SchoolShareCard {
  const upcomingCount = events.filter((event) => hasActiveEventOccurrence(event, now)).length;
  return {
    colors: getSchoolColors(school),
    schoolName: school.name,
    eventsLine: describeUpcomingEvents(upcomingCount, school.language),
    siteLine: getSchoolPublicUrl(school.slug),
  };
}

/**
 * The page metadata image for a school's card. Its URL carries a hash of what
 * the card draws, so link previews (and the CDN) fetch a new image exactly
 * when the card changes.
 */
export function buildSchoolShareImage(school: string, card: SchoolShareCard) {
  const version = createHash("sha256")
    .update(JSON.stringify(card))
    .digest("base64url")
    .slice(0, 12);
  return {
    url: `${getSchoolCanonicalUrl(school, SCHOOL_SHARE_IMAGE_PATH)}?v=${version}`,
    alt: `Upcoming events at ${card.schoolName} on Wat2Do`,
    width: controlBox.socialPreviews.width,
    height: controlBox.socialPreviews.height,
    type: "image/png",
  };
}
