import type { Metadata } from "next";

import type { School, SchoolSummary } from "@/shared/api/schools.api";
import { controlBox } from "@/shared/config/controlBox";
import { EXTERNAL_LINKS, schoolInstagramUrl } from "@/shared/constants/links";
import { ROUTES } from "@/shared/constants/routes";
import { getSchoolPublicUrl, resolveSchool } from "@/shared/constants/schools";

const SITE_NAME = "Wat2Do";
const PRODUCTION_ORIGIN = "https://wat2do.io";

type SeoLanguage = School["language"];

const OPEN_GRAPH_LOCALES: Record<SeoLanguage, string> = {
  en: "en_US",
  fr: "fr_CA",
};

export interface SeoImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
  type?: string;
}

/**
 * Wat2Do's wordmark card (frontend/public/images/brand/wat2do-share.png): the
 * preview of brand pages, and of any page without an image of its own.
 */
export const BRAND_SHARE_IMAGE: SeoImage = {
  url: `${PRODUCTION_ORIGIN}/images/brand/wat2do-share.png`,
  alt: SITE_NAME,
  width: 1200,
  height: 630,
  type: "image/png",
};

/** What Wat2Do is, for pages without a description of their own and the brand's structured data. */
export const BRAND_DESCRIPTION =
  "Club events, free food, parties, workshops and open club roles at universities across Canada and the US, all in one place and updated daily.";

interface PublicPageMetadataOptions {
  title: string;
  description: string;
  canonicalUrl: string;
  image?: SeoImage;
  index?: boolean;
  language?: SeoLanguage;
}

interface NoIndexMetadataOptions {
  title: string;
  description: string;
  image?: SeoImage;
}

function normalizePath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return `/${pathname.replace(/^\/+|\/+$/g, "")}`;
}

export function getSchoolCanonicalUrl(school: string, pathname: string): string {
  const host = getSchoolPublicUrl(resolveSchool(school));
  return `https://${host}${normalizePath(pathname)}`;
}

export function getBrandCanonicalUrl(pathname: string): string {
  return `${PRODUCTION_ORIGIN}${normalizePath(pathname)}`;
}

export function isCanonicalProductionHost(
  requestHost: string | null | undefined,
  canonicalUrl: string,
): boolean {
  const hostname = (requestHost ?? "").split(":")[0]?.toLowerCase();
  if (!hostname || !hostname.endsWith("wat2do.io")) return true;
  return hostname === new URL(canonicalUrl).hostname;
}

/** The entity's own image when it is a web URL, else Wat2Do's card. */
export function selectSeoImage(
  candidateUrl: string | null | undefined,
  candidateAlt: string,
): SeoImage {
  if (!candidateUrl) return BRAND_SHARE_IMAGE;

  try {
    const url = new URL(candidateUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return BRAND_SHARE_IMAGE;
    return { url: url.toString(), alt: candidateAlt };
  } catch {
    return BRAND_SHARE_IMAGE;
  }
}

export function buildPublicPageMetadata({
  title,
  description,
  canonicalUrl,
  image = BRAND_SHARE_IMAGE,
  index = true,
  language = "en",
}: PublicPageMetadataOptions): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: canonicalUrl },
    robots: {
      index,
      follow: true,
      googleBot: {
        index,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonicalUrl,
      siteName: SITE_NAME,
      locale: OPEN_GRAPH_LOCALES[language],
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export function buildNoIndexPageMetadata({
  title,
  description,
  image = BRAND_SHARE_IMAGE,
}: NoIndexMetadataOptions): Metadata {
  return {
    title: { absolute: title },
    description,
    robots: {
      index: false,
      follow: true,
      googleBot: {
        index: false,
        follow: true,
        "max-image-preview": "large",
      },
    },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: SITE_NAME,
      locale: OPEN_GRAPH_LOCALES.en,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

/** The pages every school's site has, each with its own title and description. */
export type SchoolPage = "events" | "clubs" | "positions" | "landing";

const SCHOOL_PAGE_PATHS: Record<SchoolPage, string> = {
  events: ROUTES.EVENTS,
  clubs: ROUTES.CLUBS,
  positions: ROUTES.POSITIONS,
  landing: ROUTES.LANDING,
};

/** A page's titles and descriptions, each list from its fullest form to its shortest. */
interface SchoolPageCopy {
  titles: string[];
  descriptions: string[];
}

type SchoolPageCopyBook = (
  schoolName: string,
  city: string | null,
) => Record<SchoolPage, SchoolPageCopy>;

// French drops "de"/"à" + "la"/"le" to "de l'"/"à l'" before a vowel: "de l'Université Laval".
const FRENCH_ELIDING_NAME = /^[aeiouàâéèêëîïôûüœ]/i;
const frenchOf = (name: string) => `${FRENCH_ELIDING_NAME.test(name) ? "de l'" : "de "}${name}`;
const frenchAt = (name: string) => `${FRENCH_ELIDING_NAME.test(name) ? "à l'" : "à "}${name}`;

/**
 * What each school page says in search results and shared links, in the
 * school's language: what a student finds there, in concrete nouns, and never
 * a live count that could read 0. docs/seo_playbook.md has the rules.
 */
const SCHOOL_PAGE_COPY: Record<SeoLanguage, SchoolPageCopyBook> = {
  en: (name, city) => ({
    events: {
      titles: [
        `${name} Events, Free Food & Parties | Wat2Do`,
        `${name} Events & Free Food | Wat2Do`,
        `${name} Events | Wat2Do`,
      ],
      descriptions: [
        ...(city
          ? [`${name} club events in one place: free food, parties, workshops, career nights and more things to do around ${city}. Updated daily.`]
          : []),
        `${name} club events in one place: free food, parties, workshops, career nights and more things to do on campus. Updated daily.`,
        `${name} club events in one place: free food, parties, workshops and career nights. Updated daily.`,
      ],
    },
    clubs: {
      titles: [
        `${name} Clubs & Student Groups | Wat2Do`,
        `${name} Clubs | Wat2Do`,
      ],
      descriptions: [
        `${name} clubs in one place: what each club does, its upcoming events, open exec roles and where to follow it. Updated daily.`,
        `${name} clubs in one place: what each club does, its events, open roles and where to follow it. Updated daily.`,
      ],
    },
    positions: {
      titles: [
        `${name} Club Positions & Exec Roles | Wat2Do`,
        `${name} Club Positions | Wat2Do`,
        `${name} Club Roles | Wat2Do`,
      ],
      descriptions: [
        `Open club roles at ${name} in one place: exec, committee and volunteer spots, paid positions and internships. Updated daily.`,
        `Open club roles at ${name}: exec, committee and volunteer spots, paid positions and internships. Updated daily.`,
      ],
    },
    landing: {
      titles: [
        `Every ${name} Event in One Place | Wat2Do`,
        `Every ${name} Event | Wat2Do`,
      ],
      descriptions: [
        `Club events at ${name} get buried across hundreds of Instagram accounts. Wat2Do puts them all in one place, minutes after clubs post.`,
        `${name} club events get buried across hundreds of Instagram accounts. Wat2Do puts them in one place, minutes after clubs post.`,
      ],
    },
  }),
  fr: (name) => ({
    events: {
      titles: [
        `Événements et activités ${frenchAt(name)} | Wat2Do`,
        `Événements ${frenchAt(name)} | Wat2Do`,
        `Événements ${frenchAt(name)}`,
      ],
      descriptions: [
        `Les événements des clubs ${frenchOf(name)} au même endroit : bouffe gratuite, partys, ateliers, soirées réseautage et plus. Mis à jour chaque jour.`,
        `Les événements des clubs ${frenchOf(name)} au même endroit : bouffe gratuite, partys, ateliers et réseautage. Mis à jour chaque jour.`,
      ],
    },
    clubs: {
      titles: [
        `Clubs et associations ${frenchOf(name)} | Wat2Do`,
        `Clubs ${frenchOf(name)} | Wat2Do`,
      ],
      descriptions: [
        `Les clubs ${frenchOf(name)} au même endroit : ce que fait chaque club, ses prochains événements, ses postes ouverts et où le suivre. Mis à jour chaque jour.`,
        `Les clubs ${frenchOf(name)} au même endroit : ce que fait chaque club, ses événements, ses postes et où le suivre. Mis à jour chaque jour.`,
      ],
    },
    positions: {
      titles: [
        `Postes dans les clubs ${frenchOf(name)} | Wat2Do`,
        `Postes en club ${frenchAt(name)} | Wat2Do`,
        `Postes en club ${frenchAt(name)}`,
      ],
      descriptions: [
        `Les postes ouverts dans les clubs ${frenchOf(name)} au même endroit : exécutif, comités, bénévolat, postes rémunérés et stages. Mis à jour chaque jour.`,
        `Les postes ouverts dans les clubs ${frenchOf(name)} : exécutif, comités, bénévolat, postes rémunérés et stages. Mis à jour chaque jour.`,
      ],
    },
    landing: {
      titles: [
        `Tous les événements ${frenchOf(name)} | Wat2Do`,
        `Tous les événements ${frenchOf(name)}`,
      ],
      descriptions: [
        `Les événements des clubs ${frenchOf(name)} se perdent dans des centaines de comptes Instagram. Wat2Do les réunit au même endroit, dès leur publication.`,
        `Les événements ${frenchOf(name)} se perdent dans des centaines de comptes Instagram. Wat2Do les réunit au même endroit, dès leur publication.`,
        `Les événements ${frenchOf(name)} se perdent dans des centaines de comptes Instagram. Wat2Do les réunit au même endroit.`,
      ],
    },
  }),
};

/** The fullest candidate within `maxCharacters`, else the shortest one. */
function firstThatFits(candidates: readonly string[], maxCharacters: number): string {
  return candidates.find((candidate) => candidate.length <= maxCharacters) ?? candidates[candidates.length - 1];
}

interface SchoolPageMetadataOptions {
  page: SchoolPage;
  /** The requesting host's school. */
  school: string;
  /** Its record, or null when the school directory cannot be read. */
  schoolRecord: School | null;
  image: SeoImage;
  index?: boolean;
}

/** A school page's metadata, in the school's language, on the school's own host. */
export function buildSchoolPageMetadata({
  page,
  school,
  schoolRecord,
  image,
  index,
}: SchoolPageMetadataOptions): Metadata {
  const language = schoolRecord?.language ?? "en";
  const copy = SCHOOL_PAGE_COPY[language](
    schoolRecord?.name ?? school,
    schoolRecord?.city ?? null,
  )[page];
  const { titleMaxCharacters, descriptionMaxCharacters } = controlBox.socialPreviews;

  return buildPublicPageMetadata({
    title: firstThatFits(copy.titles, titleMaxCharacters),
    description: firstThatFits(copy.descriptions, descriptionMaxCharacters),
    canonicalUrl: getSchoolCanonicalUrl(school, SCHOOL_PAGE_PATHS[page]),
    image,
    index,
    language,
  });
}

/**
 * Wat2Do itself and its website, for the home page (the events feed the root
 * opens) and the about page. Every school's Wat2Do Instagram account is one of
 * the brand's profiles.
 */
export function buildBrandStructuredData(
  schools: readonly Pick<SchoolSummary, "slug">[],
): Record<string, unknown> {
  const organizationId = `${PRODUCTION_ORIGIN}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: SITE_NAME,
        url: `${PRODUCTION_ORIGIN}/`,
        description: BRAND_DESCRIPTION,
        logo: {
          "@type": "ImageObject",
          url: `${PRODUCTION_ORIGIN}/icon-512.png`,
          width: 512,
          height: 512,
        },
        sameAs: [
          EXTERNAL_LINKS.LINKEDIN,
          ...schools.map((school) => schoolInstagramUrl(school.slug)),
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${PRODUCTION_ORIGIN}/#website`,
        name: SITE_NAME,
        url: `${PRODUCTION_ORIGIN}/`,
        description: BRAND_DESCRIPTION,
        publisher: { "@id": organizationId },
      },
    ],
  };
}
