/**
 * Slide view models for the published carousel image.
 *
 * A carousel slide is a deterministic function of event data: the same event
 * always produces the same slide, in both the admin preview and PNG render route.
 */

import {
  getClubCategoryConfig,
  getClubCategoryDoodleDataUris,
} from "@/shared/data/clubCategoryStyles";
import { getSchoolPublicUrl } from "@/shared/constants/schools";
import type { SchoolColors } from "@/shared/lib/schoolBranding";
import { buildInstagramCoverLogo } from "@/features/admin/lib/instagramCoverLogo";
import { createInstance, type i18n } from "i18next";
import type { School } from "@/shared/api/schools.api";
import { formatCardTime } from "@/shared/utils/date";
import { computeEventBadges, translateCategory } from "@/shared/utils/event";
import sharedEnglish from "@/shared/locales/en.json" with { type: "json" };
import eventsEnglish from "@/features/events/locales/en.json" with { type: "json" };
import clubsEnglish from "@/features/clubs/locales/en.json" with { type: "json" };
import { loadLazyLanguage } from "@/shared/lib/languageLoaders";

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;

/** Event fields a slide reads. Mirrors the backend's stored event snapshot. */
export interface SlideEvent {
  id: number;
  title?: string | null;
  category?: string | null;
  location?: string | null;
  club?: string | null;
  ig_handle?: string | null;
  school?: string | null;
  source_image_url?: string | null;
  added_at?: string | null;
  dtstart_utc?: string | null;
  dtend_utc?: string | null;
  /** IANA zone resolved server-side; slides print local times. */
  tz: string;
  price?: number | null;
  food?: string[] | null;
  cancelled?: boolean | null;
  registration?: boolean | null;
}

export interface EventSlideModel {
  eventId: number;
  /** Category chip, coloured from the shared category registry. */
  category: { label: string; color: string };
  title: string;
  dateLine: string;
  timeLine: string;
  location: string;
  /** Club attribution below the title. */
  clubLine: string;
  /** Price / free-food chips, mirroring the event card's badge column. */
  badges: string[];
  imageSrc: string;
  addedLine: string;
}

export interface CoverSlideModel {
  /** The school's brand pair; the whole cover is drawn from these two colours. */
  colors: SchoolColors;
  /** The canonical Wat2Do mark recoloured from the same school pair. */
  logoSrc: string;
  /** Stable category doodles recoloured with the school's secondary color. */
  doodleIcons: string[];
  /** The batch date, for example "Sunday, July 26th". */
  dateLine: string;
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

const slideLocales = new Map<School["language"], Promise<i18n>>();

/** Artwork never changes the reviewing admin's language or another render's locale. */
export function getInstagramSlideLocale(language: School["language"]): Promise<i18n> {
  let locale = slideLocales.get(language);
  if (!locale) {
    locale = (async () => {
      const translation = language === "en"
        ? { ...sharedEnglish, ...eventsEnglish, ...clubsEnglish }
        : await loadLazyLanguage(language);
      const instance = createInstance();
      await instance.init({
        lng: language,
        fallbackLng: false,
        interpolation: { escapeValue: false },
        resources: { [language]: { translation } },
      });
      return instance;
    })().catch(error => {
      slideLocales.delete(language);
      throw error;
    });
    slideLocales.set(language, locale);
  }
  return locale;
}

function text(value: string | null | undefined, fallback = ""): string {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}

/**
 * Absolute dates survive publication; times share the event card's range formatter.
 *
 * Formatted with an explicit zone so the browser preview and the server render
 * agree regardless of where either one runs.
 */
function formatSlideDate(event: SlideEvent, locale: string): { dateLine: string; timeLine: string } {
  const start = event.dtstart_utc ? new Date(event.dtstart_utc) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return { dateLine: "", timeLine: "" };
  }

  const timeZone = event.tz;
  return {
    dateLine: new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      timeZone,
    }).format(start),
    timeLine: formatCardTime({ occurrences: [{ dtstart_utc: event.dtstart_utc!, dtend_utc: event.dtend_utc }] }, timeZone, locale),
  };
}

export async function buildEventSlideModel(
  event: SlideEvent,
  language: School["language"],
  imageSrc = event.source_image_url ?? "",
): Promise<EventSlideModel> {
  if (!event.tz) throw new Error("School timezone is required for event slides");
  const { t } = await getInstagramSlideLocale(language);
  const { dateLine, timeLine } = formatSlideDate(event, language);
  const category = getClubCategoryConfig(event.category);
  const addedAt = event.added_at ? new Date(event.added_at) : null;
  const addedLine = addedAt && Number.isFinite(addedAt.getTime())
    ? t("events.slideAddedAt", { date: new Intl.DateTimeFormat(language, {
      year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: event.tz,
    }).format(addedAt) }) : "";
  return {
    eventId: event.id,
    category: { label: translateCategory(text(event.category), t), color: category.color },
    title: text(event.title),
    dateLine: text(dateLine),
    timeLine: text(timeLine),
    location: text(event.location),
    clubLine: text(event.club),
    badges: computeEventBadges({ ...event, food: event.food ?? [], cancelled: event.cancelled ?? false, registration: event.registration ?? false }, t).map(badge => badge.text),
    imageSrc,
    addedLine: text(addedLine),
  };
}

/**
 * The cover, compiled from the batch it belongs to.
 *
 * Everything on it is derived: the school decides the colours and the link, the
 * batch's local date supplies the date line, the scrape window supplies the
 * headline number, and the carousel's events supply the selection count and
 * fanned posters. `body` is the one line an admin writes; left empty it states
 * how many events were picked.
 */
export function buildCoverSlideModel({
  school,
  language,
  colors,
  localDate,
  newEventCount,
  eventCount,
  body,
  tiles,
}: {
  school: string;
  language: "en" | "fr";
  colors: SchoolColors;
  /** The batch's `local_date`, as `YYYY-MM-DD`. */
  localDate: string;
  newEventCount: number;
  /** Number of event IDs in the batch, including events without poster images. */
  eventCount: number;
  body: string;
  tiles: string[];
}): CoverSlideModel {
  return {
    colors,
    logoSrc: buildInstagramCoverLogo(colors),
    doodleIcons: getClubCategoryDoodleDataUris(colors.secondary, 42),
    dateLine: formatCoverDate(localDate, language),
    newEventCount,
    // Selected events can predate both the batch date and its recent-event window.
    headline: language === "fr" ? "ÉVÉNEMENTS À DÉCOUVRIR" : "EVENTS TO EXPLORE",
    body: text(body, defaultCoverBody(eventCount, language)),
    swipeLine: language === "fr" ? "Voir les événements" : "Swipe to see the events",
    siteLine: `${language === "fr" ? "Plus d’infos sur" : "More info on"} ${getSchoolPublicUrl(school)}`,
    tiles,
  };
}

export function defaultCoverBody(eventCount: number, language: "en" | "fr"): string {
  return language === "fr" ? `${eventCount} événements sur le campus à découvrir` : `Here are the ${eventCount} you should know about`;
}

/**
 * "Sunday, July 26th" from a `YYYY-MM-DD` local date.
 *
 * Formatted in UTC because the date is already local to the school: parsing it
 * gives UTC midnight, and any other zone would slide it a day.
 */
function formatCoverDate(localDate: string, language: "en" | "fr"): string {
  const parsed = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  if (language === "fr") return new Intl.DateTimeFormat("fr-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(parsed);

  const parts = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).formatToParts(parsed);
  const weekday = parts.find(({ type }) => type === "weekday")?.value ?? "";
  const month = parts.find(({ type }) => type === "month")?.value ?? "";
  const day = parsed.getUTCDate();
  const suffix =
    day % 100 >= 11 && day % 100 <= 13
      ? "th"
      : (["th", "st", "nd", "rd"][day % 10] ?? "th");

  return `${weekday}, ${month} ${day}${suffix}`;
}
