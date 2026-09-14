import type { Metadata } from "next";

import { getSchoolPublicUrl, resolveSchool } from "@/shared/constants/schools";

const SITE_NAME = "Wat2Do";
const PRODUCTION_ORIGIN = "https://wat2do.io";

interface SeoImage {
  url: string;
  alt: string;
  width?: number;
  height?: number;
  type?: string;
}

interface PublicPageMetadataOptions {
  title: string;
  description: string;
  canonicalUrl: string;
  image: SeoImage;
  index?: boolean;
}

interface NoIndexMetadataOptions {
  title: string;
  description: string;
  image: SeoImage;
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

export function selectSeoImage(
  candidateUrl: string | null | undefined,
  candidateAlt: string,
  fallback: SeoImage,
  candidateProperties: Omit<SeoImage, "url" | "alt"> = {},
): SeoImage {
  if (!candidateUrl) return fallback;

  try {
    const url = new URL(candidateUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return fallback;
    return { url: url.toString(), alt: candidateAlt, ...candidateProperties };
  } catch {
    return fallback;
  }
}

export function buildPublicPageMetadata({
  title,
  description,
  canonicalUrl,
  image,
  index = true,
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
      locale: "en_US",
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
  image,
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
      locale: "en_US",
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
