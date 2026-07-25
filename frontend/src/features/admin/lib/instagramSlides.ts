/**
 * Slide view models.
 *
 * A carousel slide is a deterministic function of event data: the same snapshot
 * always produces the same slide. This module is that function, shared by the
 * admin preview and the PNG render route so the image an admin approves is the
 * image Instagram receives.
 */

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
}

export interface EventSlideModel {
  eventId: number;
  category: string;
  title: string;
  dateLine: string;
  location: string;
  organizationLine: string;
  imageSrc: string;
}

export interface CoverSlideModel {
  headline: string;
  schoolName: string;
  body: string;
  tiles: string[];
}

export const COVER_DEFAULT_BODY = "Added to Wat2Do in the last 24 hours";
const FALLBACK_CATEGORY = "Campus event";
const FALLBACK_TITLE = "Untitled event";
const FALLBACK_LOCATION = "See Wat2Do for location";
const FALLBACK_ORGANIZATION = "Campus organization";

function text(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

/**
 * The event's start in its own timezone, e.g. "Friday, July 25 at 7:30 PM".
 *
 * Formatted with an explicit zone so the browser preview and the server render
 * agree regardless of where either one runs.
 */
export function formatSlideDate(event: SlideEvent): string {
  if (!event.dtstart_utc) return "Date to be announced";
  const start = new Date(event.dtstart_utc);
  if (Number.isNaN(start.getTime())) return "Date to be announced";

  const timeZone = event.tz || "UTC";
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(start);
  return `${day} at ${time}`;
}

export function buildEventSlideModel(
  event: SlideEvent,
  imageSrc = event.source_image_url ?? "",
): EventSlideModel {
  const handle = (event.ig_handle ?? "").trim().replace(/^@/, "");
  return {
    eventId: event.id,
    category: text(event.category, FALLBACK_CATEGORY),
    title: text(event.title, FALLBACK_TITLE),
    dateLine: formatSlideDate(event),
    location: text(event.location, FALLBACK_LOCATION),
    organizationLine: handle
      ? `@${handle}`
      : text(event.organization, FALLBACK_ORGANIZATION),
    imageSrc,
  };
}

export function buildCoverSlideModel({
  schoolName,
  body,
  tiles,
}: {
  schoolName: string;
  body: string;
  tiles: string[];
}): CoverSlideModel {
  return {
    headline: "New events at",
    schoolName,
    body: text(body, COVER_DEFAULT_BODY),
    tiles,
  };
}
