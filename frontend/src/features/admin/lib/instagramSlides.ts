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
  headline: string;
  schoolName: string;
  body: string;
  tiles: string[];
}

const COVER_DEFAULT_BODY = "Added to Wat2Do in the last 24 hours";
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
