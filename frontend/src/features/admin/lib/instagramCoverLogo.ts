import type { SchoolColors } from "@/shared/lib/schoolBranding";

const SOURCE_BACKGROUND = 'fill="#0C22EF"';
const SOURCE_MARK = 'stroke="white"';
const SOURCE_EYE = 'stroke="black"';
const sourceSvg = process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG ?? "";
const logoCache = new Map<string, string>();

/**
 * Recolour the canonical Wat2Do cover logo without maintaining school-specific
 * copies. The square and eye use the secondary color while the mark uses primary.
 */
export function buildInstagramCoverLogo(
  colors: SchoolColors,
): string {
  const cacheKey = `${colors.primary}:${colors.secondary}`;
  const cachedLogo = logoCache.get(cacheKey);
  if (cachedLogo) return cachedLogo;

  if (
    !sourceSvg.includes(SOURCE_BACKGROUND) ||
    !sourceSvg.includes(SOURCE_MARK) ||
    !sourceSvg.includes(SOURCE_EYE)
  ) {
    throw new Error("Instagram cover logo source is unavailable or malformed");
  }

  const colorizedSvg = sourceSvg
    .replace(SOURCE_BACKGROUND, `fill="${colors.secondary}"`)
    .replaceAll(SOURCE_MARK, `stroke="${colors.primary}"`)
    .replace(SOURCE_EYE, `stroke="${colors.secondary}"`);
  const logo = `data:image/svg+xml;base64,${btoa(colorizedSvg)}`;

  logoCache.set(cacheKey, logo);
  return logo;
}
