const SOURCE_BACKGROUND = 'fill="#0C22EF"';
const SOURCE_MARK = 'stroke="white"';
const SOURCE_EYE = 'stroke="black"';
const sourceSvg = process.env.NEXT_PUBLIC_INSTAGRAM_COVER_LOGO_SVG ?? "";
const logoCache = new Map<string, string>();

/**
 * Recolour the canonical Wat2Do cover logo to sit on a slide. The square and eye
 * take the slide's background so only the mark, in the foreground colour, reads.
 */
export function buildInstagramCoverLogo(
  colors: { background: string; foreground: string },
): string {
  const cacheKey = `${colors.background}:${colors.foreground}`;
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
    .replace(SOURCE_BACKGROUND, `fill="${colors.background}"`)
    .replaceAll(SOURCE_MARK, `stroke="${colors.foreground}"`)
    .replace(SOURCE_EYE, `stroke="${colors.background}"`);
  const logo = `data:image/svg+xml;base64,${btoa(colorizedSvg)}`;

  logoCache.set(cacheKey, logo);
  return logo;
}
