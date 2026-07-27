/**
 * Slide view models for the published carousel image.
 *
 * A carousel slide is a deterministic function of event data: the same event
 * always produces the same slide. This module is that function, and it runs in
 * the PNG render route (`/api/render-instagram-slide`) - plus the cover, which
 * previews in the admin editor because it has no in-app equivalent. Event
 * slides preview as the app's own event card instead.
 */

import { getOrganizationCategoryConfig } from "@/shared/data/organizationCategoryStyles";
import {
  getSchoolColors,
  getSchoolPublicUrl,
  type SchoolColors,
} from "@/shared/constants/schools";

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;

/** Event fields a slide reads. Mirrors the backend's stored event snapshot. */
export interface SlideEvent {
  id: number;
  title?: string | null;
  category?: string | null;
  location?: string | null;
  organization?: string | null;
  ig_handle?: string | null;
  school?: string | null;
  source_image_url?: string | null;
  dtstart_utc?: string | null;
  /** IANA zone resolved server-side; slides print local times. */
  tz?: string | null;
  price?: number | null;
  food?: string[] | null;
  cancelled?: boolean | null;
}

export interface EventSlideModel {
  eventId: number;
  /** Category chip, coloured from the shared category registry. */
  category: { label: string; color: string };
  title: string;
  dateLine: string;
  timeLine: string;
  location: string;
  /** Full organization name - a slide has room, so it is never truncated. */
  organizationLine: string;
  /** Price / free-food chips, mirroring the event card's badge column. */
  badges: string[];
  imageSrc: string;
}

export interface CoverSlideModel {
  /** The school's brand pair; the whole cover is drawn from these two colours. */
  colors: SchoolColors;
  /** "SUN JUL 26 · EVENT SHOWCASE" */
  eyebrow: string;
  /** Events added to this school in the batch's scrape window. */
  newEventCount: number;
  headline: string;
  body: string;
  /** Footer copy: the swipe prompt, and the school's own origin. */
  swipeLine: string;
  siteLine: string;
  /** Posters of the events on the carousel, fanned along the lower edge. */
  tiles: string[];
}

// Slide copy is English-only: a slide is artwork posted to one Instagram
// account, not app UI, so it never passes through i18n.
const COVER_HEADLINE = "NEW EVENTS ADDED TODAY";
const COVER_EYEBROW_SUFFIX = "EVENT SHOWCASE";
const COVER_SWIPE_LINE = "Swipe to see our picks →";
const FALLBACK_TITLE = "Untitled event";
const FALLBACK_LOCATION = "See Wat2Do for location";
const FALLBACK_ORGANIZATION = "Campus organization";

function text(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

/**
 * The event's start in its own timezone, split the way an event card shows it.
 *
 * Formatted with an explicit zone so the browser preview and the server render
 * agree regardless of where either one runs.
 */
function formatSlideDate(event: SlideEvent): { dateLine: string; timeLine: string } {
  const start = event.dtstart_utc ? new Date(event.dtstart_utc) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return { dateLine: "Date to be announced", timeLine: "" };
  }

  const timeZone = event.tz || "UTC";
  return {
    dateLine: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone,
    }).format(start),
    timeLine: new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(start),
  };
}

/** Price and free-food chips, matching `computeEventBadges` on the event card. */
function slideBadges(event: SlideEvent): string[] {
  const badges: string[] = [];
  if (event.cancelled) badges.push("Cancelled");
  if (event.price != null && event.price > 0) badges.push(`$${event.price}`);
  if ((event.food ?? []).length > 0) badges.push("Free food");
  return badges;
}

export function buildEventSlideModel(
  event: SlideEvent,
  imageSrc = event.source_image_url ?? "",
): EventSlideModel {
  const { dateLine, timeLine } = formatSlideDate(event);
  const category = getOrganizationCategoryConfig(event.category);
  return {
    eventId: event.id,
    category: { label: text(event.category, category.label), color: category.color },
    title: text(event.title, FALLBACK_TITLE),
    dateLine,
    timeLine,
    location: text(event.location, FALLBACK_LOCATION),
    organizationLine: text(event.organization, FALLBACK_ORGANIZATION),
    badges: slideBadges(event),
    imageSrc,
  };
}

/**
 * The cover, compiled from the batch it belongs to.
 *
 * Everything on it is derived: the school decides the colours and the link, the
 * batch's local date is the eyebrow, the scrape window supplies the headline
 * number, and the carousel's events supply the fanned posters. `body` is the
 * one line an admin writes; left empty it states how many events were picked.
 */
export function buildCoverSlideModel({
  school,
  localDate,
  newEventCount,
  body,
  tiles,
}: {
  school: string;
  /** The batch's `local_date`, as `YYYY-MM-DD`. */
  localDate: string;
  newEventCount: number;
  body: string;
  tiles: string[];
}): CoverSlideModel {
  return {
    colors: getSchoolColors(school),
    eyebrow: [formatCoverDate(localDate), COVER_EYEBROW_SUFFIX].filter(Boolean).join(" · "),
    newEventCount,
    headline: COVER_HEADLINE,
    body: text(body, defaultCoverBody(tiles.length)),
    swipeLine: COVER_SWIPE_LINE,
    siteLine: `More info on ${getSchoolPublicUrl(school)}`,
    tiles,
  };
}

function defaultCoverBody(pickCount: number): string {
  return pickCount === 1
    ? "Here is the one we like the most"
    : `Here are the ${pickCount} we like the most`;
}

/**
 * "SUN JUL 26" from a `YYYY-MM-DD` local date.
 *
 * Formatted in UTC because the date is already local to the school: parsing it
 * gives UTC midnight, and any other zone would slide it a day.
 */
function formatCoverDate(localDate: string): string {
  const parsed = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
    .format(parsed)
    .replace(",", "")
    .toUpperCase();
}
