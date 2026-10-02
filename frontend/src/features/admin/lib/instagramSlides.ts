import { normalizeInstagramHandle } from "@/shared/utils/url";
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
import { getAppConstantsSnapshot } from "@/shared/api/metaApi";
import { getSchoolPublicUrl } from "@/shared/constants/schools";
import { getSchoolColors, type SchoolColors } from "@/shared/lib/schoolBranding";
import { buildInstagramCoverLogo } from "@/features/admin/lib/instagramCoverLogo";
import { createInstance, type i18n } from "i18next";
import type { School } from "@/shared/api/schools.api";
import type { ApiInstagramPublishBatchResponse } from "@/shared/generated";
import { formatCardTime } from "@/shared/utils/date";
import { computeEventBadges, translateCategory } from "@/shared/utils/event";
import sharedEnglish from "@/shared/locales/en.json" with { type: "json" };
import eventsEnglish from "@/features/events/locales/en.json" with { type: "json" };
import clubsEnglish from "@/features/clubs/locales/en.json" with { type: "json" };
import { loadLazyLanguage } from "@/shared/lib/languageLoaders";
import instagramPublishing from "../../../../../backend/controlbox/instagram_publishing.json" with { type: "json" };

export const SLIDE_WIDTH = 1080;
export const SLIDE_HEIGHT = 1350;
/** Raster preparation and template layout use the same physical image bounds. */
export const SLIDE_POSTER_REGIONS = {
  event: { width: SLIDE_WIDTH - 128, height: 850 },
  cover: { width: 220, height: 308 },
  avatar: { width: 88, height: 88 },
} as const;

/** Event fields a slide reads. Mirrors the backend's stored event snapshot. */
export interface SlideEvent {
  id: number;
  sticker_labels?: string[];
  club_id?: number | null;
  title?: string | null;
  description?: string | null;
  category?: string | null;
  location?: string | null;
  club?: string | null;
  ig_handle?: string | null;
  club_ig?: string | null;
  club_logo_url?: string | null;
  school?: string | null;
  source_image_url?: string | null;
  dtstart_utc?: string | null;
  dtend_utc?: string | null;
  /** IANA zone resolved server-side; slides print local times. */
  tz: string;
  price?: number | null;
  food?: string[] | null;
  cancelled?: boolean | null;
  registration?: boolean | null;
}

export const SLIDE_STICKER_SIZE = { width: 228, height: 94 } as const;

export interface EventSlideModel {
  /** Localized event category, also used by the artwork review library. */
  category: { label: string; color: string };
  title: string;
  dateLine: string;
  timeLine: string;
  location: string;
  /** Instagram handle, or the club name when no handle is known. */
  author: string;
  avatarSrc: string;
  /** The school's public domain, also used in the artwork review library. */
  siteName: string;
  colors: SchoolColors;
  doodleIcons: string[];
  stickers: { id: string; label: string; lines: string[]; shape: number; styleSeed: number; left: number; top: number; rotation: number }[];
  /** Event facts use the same localized labels as the website's cards. */
  badges: string[];
  imageSrc: string;
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

/** Semantic styles stay the same across schools, events and label ordering. */
function stickerStyle(label: string): { shape: number; styleSeed: number } {
  const normalized = label.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}$]+/gu, " ").trim();
  const families = [
    { shape: 2, words: /\b(reg|registration|rsvp|inscr|inscription)\b/ },
    { shape: 3, words: /\b(food|pizza|snacks?|meals?|breakfast|lunch|dinner|tea|coffee|drink|refreshments|bbq|repas|nourriture|cafe|collation|boisson)\b/ },
    { shape: 0, words: /\b(free|gratuit|gratuite)\b|\$|\b(entry|admission|cost|price|paid|tickets?|tarif|prix|entree|billet)\b/ },
    { shape: 1, words: /\b(prizes?|cash|awards?|gifts?|giveaways?|lots?|cadeaux|recompenses)\b/ },
    { shape: 9, words: /\b(meet|friends?|networking|network|people|social|rencontre|reseautage|amis)\b/ },
    { shape: 6, words: /\b(workshop|learn|skills?|training|prep|expert|atelier|formation)\b/ },
    { shape: 7, words: /\b(games?|quiz|trivia|play|jeux|jeu)\b/ },
    { shape: 5, words: /\b(welcome|open|everyone|bienvenue|tous)\b/ },
    { shape: 8, words: /\b(show|music|live|performance|concert|spectacle|musique)\b/ },
  ];
  const family = families.find(({ words }) => words.test(normalized));
  const hash = [...normalized].reduce((value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0, 0);
  return { shape: family?.shape ?? hash % instagramPublishing.sticker_shape_count, styleSeed: family?.shape ?? hash };
}

/** Fill the white footer before covering any event artwork. */
function stickerPositions(eventId: number) {
  const compositions = [
    [[90, 1062], [414, 1062], [740, 1062], [550, 1178]],
    [[90, 1178], [414, 1178], [740, 1178], [240, 1062]],
    [[90, 1062], [414, 1062], [740, 1062], [180, 1178]],
    [[90, 1178], [414, 1178], [740, 1178], [620, 1062]],
  ];
  let seed = Math.imul(eventId, 2654435761) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const composition = compositions[Math.floor(random() * compositions.length)];
  const positions = composition.map(([left, top]) => ({
    left: left + Math.floor(random() * 7) - 3,
    top: top + Math.floor(random() * 7) - 3,
    rotation: Math.floor(random() * 9) - 4,
  }));
  // Label order does not dictate which side or row gets a practical detail.
  for (let index = positions.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [positions[index], positions[other]] = [positions[other], positions[index]];
  }
  return positions;
}

export async function buildEventSlideModel(
  event: SlideEvent,
  language: School["language"],
  imageSrc = event.source_image_url ?? "",
  avatarSrc = event.club_logo_url ?? "",
  context?: { school: Pick<School, "name" | "primary_color" | "secondary_color"> },
): Promise<EventSlideModel> {
  if (!event.tz) throw new Error("School timezone is required for event slides");
  const categoryName = event.category?.trim() ?? "";
  if (!getAppConstantsSnapshot().event_categories.includes(categoryName)) {
    throw new Error(`Event ${event.id} needs a valid category before rendering an Instagram slide`);
  }
  const { t } = await getInstagramSlideLocale(language);
  const { dateLine, timeLine } = formatSlideDate(event, language);
  const category = getClubCategoryConfig(categoryName);
  const siteName = getSchoolPublicUrl(event.school);
  const colors = context ? getSchoolColors(context.school) : { primary: "#FFD54A", secondary: "#171A16" };
  const positions = stickerPositions(event.id);
  const stickers = [...new Set(event.sticker_labels ?? [])].slice(0, instagramPublishing.maximum_stickers_per_event)
    .map((label, index) => {
      const lines: string[] = [];
      for (const word of label.split(/\s+/)) {
        const last = lines.at(-1);
        if (last && [...`${last} ${word}`].length <= instagramPublishing.sticker_line_character_limit)
          lines[lines.length - 1] = `${last} ${word}`;
        else lines.push(word);
      }
      if (lines.length > instagramPublishing.sticker_maximum_lines || lines.some(line => [...line].length > instagramPublishing.sticker_line_character_limit))
        throw new Error(`Event ${event.id} has a sticker that exceeds the artwork text bounds`);
      return { id: String(index), label, lines, ...stickerStyle(label), ...positions[index] };
    });
  const handle = normalizeInstagramHandle(event.ig_handle) || normalizeInstagramHandle(event.club_ig);
  return {
    category: { label: translateCategory(categoryName, t), color: category.color },
    title: text(event.title),
    dateLine: text(dateLine),
    timeLine: text(timeLine),
    location: text(event.location),
    author: handle || text(event.club, siteName),
    avatarSrc,
    siteName,
    colors,
    doodleIcons: getClubCategoryDoodleDataUris(colors.secondary, 42),
    stickers,
    badges: computeEventBadges({ ...event, food: event.food ?? [], cancelled: event.cancelled ?? false, registration: event.registration ?? false }, t).map(badge => badge.text),
    imageSrc,
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
  batchKind = "events",
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
  batchKind?: ApiInstagramPublishBatchResponse["batch_kind"];
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
    headline: batchKind === "employers_on_campus"
      ? (language === "fr" ? "EMPLOYEURS SUR LE CAMPUS" : "EMPLOYERS ON CAMPUS")
      : (language === "fr" ? "NOUVEAUX ÉVÉNEMENTS À DÉCOUVRIR" : "NEW EVENTS TO EXPLORE"),
    body: text(body, batchKind === "employers_on_campus"
      ? (language === "fr" ? `${eventCount} occasions de rencontrer des employeurs` : `${eventCount} opportunities to meet employers`)
      : defaultCoverBody(eventCount, language)),
    swipeLine: language === "fr" ? "Voir les événements" : "Swipe to see the events",
    siteLine: `${language === "fr" ? "Plus d’infos sur" : "More info on"} ${getSchoolPublicUrl(school)}`,
    tiles: tiles.slice(0, instagramPublishing.maximum_event_slides),
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
