/**
 * The ten supported club categories.
 *
 * Single source of truth for a category's label, card colour, and icon. Colour
 * is semantic and stable: every club in a category renders identically,
 * with no hashing and no per-component conditionals. Keyed by slug so the
 * registry key, the colour, and the SVG filename are always the same string.
 *
 * Event cards deliberately do NOT use this - they keep their own category
 * palette in `shared/utils/event.ts`.
 */
const clubCategoryStyles = {
  "arts-culture": {
    label: "Arts & Culture",
    color: "#FFB3C2",
    icon: "/icons/club-categories/arts-culture.svg",
  },
  "academics-science": {
    label: "Academics & Science",
    color: "#B8D8FF",
    icon: "/icons/club-categories/academics-science.svg",
  },
  business: {
    label: "Business",
    color: "#9BD9FF",
    icon: "/icons/club-categories/business.svg",
  },
  "community-service": {
    label: "Community Service",
    color: "#91E7C5",
    icon: "/icons/club-categories/community-service.svg",
  },
  environment: {
    label: "Environment",
    color: "#C9F840",
    icon: "/icons/club-categories/environment.svg",
  },
  "games-recreation": {
    label: "Games & Recreation",
    color: "#FFE94A",
    icon: "/icons/club-categories/games-recreation.svg",
  },
  health: {
    label: "Health",
    color: "#FF9E8F",
    icon: "/icons/club-categories/health.svg",
  },
  "media-web": {
    label: "Media & Web",
    color: "#A9C1FF",
    icon: "/icons/club-categories/media-web.svg",
  },
  "politics-advocacy": {
    label: "Politics & Advocacy",
    color: "#C5B8FF",
    icon: "/icons/club-categories/politics-advocacy.svg",
  },
  "religion-spirituality": {
    label: "Religion & Spirituality",
    color: "#FFBE8A",
    icon: "/icons/club-categories/religion-spirituality.svg",
  },
} as const;

type ClubCategoryStyle = keyof typeof clubCategoryStyles;

interface ClubCategoryConfig {
  label: string;
  color: string;
  icon: string;
}

/** Neutral config for unknown or malformed category values. */
const defaultClubCategory: ClubCategoryConfig = {
  label: "Club",
  color: "#E8E8E8",
  icon: "/icons/club-categories/default.svg",
};

/**
 * Ink used for text and icons sitting on a category colour.
 *
 * Every colour above is a light pastel, so one dark ink is readable on all of
 * them. It is fixed rather than themed because the swatch it sits on is fixed.
 */
export const clubCategoryInk = "#1A1A1A";

/** Display label -> slug, so database category strings resolve to the registry. */
const SLUG_BY_LABEL: Record<string, ClubCategoryStyle> = Object.fromEntries(
  (Object.keys(clubCategoryStyles) as ClubCategoryStyle[]).map((slug) => [
    normalizeKey(clubCategoryStyles[slug].label),
    slug,
  ]),
) as Record<string, ClubCategoryStyle>;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Resolve any stored category string to a presentation-style slug.
 * Accepts display labels ("Arts & Culture") and slugs ("arts-culture") alike.
 */
function toClubCategoryStyle(
  value: string | null | undefined,
): ClubCategoryStyle | null {
  if (!value) return null;
  const key = normalizeKey(value);
  if (Object.hasOwn(clubCategoryStyles, key)) return key as ClubCategoryStyle;
  return SLUG_BY_LABEL[key] ?? null;
}

/** Registry entry for a category, falling back to the neutral config. */
export function getClubCategoryConfig(
  value: string | null | undefined,
): ClubCategoryConfig {
  const slug = toClubCategoryStyle(value);
  return slug ? clubCategoryStyles[slug] : defaultClubCategory;
}

/** All slugs in registry order, for previews and filters. */
export const CLUB_CATEGORY_STYLE_SLUGS = Object.keys(
  clubCategoryStyles,
) as ClubCategoryStyle[];

const rawDoodleSvgs = JSON.parse(
  process.env.NEXT_PUBLIC_CLUB_CATEGORY_DOODLE_SVGS ?? "{}",
) as Record<string, string>;
const doodleIconSequenceCache = new Map<number, string[]>();
const doodleIconDataUriCache = new Map<string, string[]>();

/**
 * A balanced, stable shuffle of the category icons for decorative fields.
 *
 * The same count always produces the same arrangement on server and client,
 * and every icon is used evenly before any icon is repeated again.
 */
function getClubCategoryDoodleIcons(count: number): string[] {
  const cachedIcons = doodleIconSequenceCache.get(count);
  if (cachedIcons) return cachedIcons;

  const options = CLUB_CATEGORY_STYLE_SLUGS.map(
    (slug) => clubCategoryStyles[slug].icon,
  );
  const icons = Array.from(
    { length: count },
    (_, index) => options[index % options.length],
  );

  let seed = 853;
  for (let index = icons.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    const randomIndex = seed % (index + 1);
    const currentIcon = icons[index];
    icons[index] = icons[randomIndex];
    icons[randomIndex] = currentIcon;
  }

  doodleIconSequenceCache.set(count, icons);
  return icons;
}

/**
 * The same decorative sequence as inline SVGs recoloured for generated art.
 *
 * Satori rejects relative image paths, so the cover model embeds the canonical
 * public SVG assets as data URIs instead of maintaining a second icon set.
 */
export function getClubCategoryDoodleDataUris(
  color: string,
  count: number,
): string[] {
  const cacheKey = `${color}:${count}`;
  const cachedIcons = doodleIconDataUriCache.get(cacheKey);
  if (cachedIcons) return cachedIcons;

  const icons = getClubCategoryDoodleIcons(count).map((iconPath) => {
    const sourceSvg = rawDoodleSvgs[iconPath];
    if (!sourceSvg) {
      throw new Error(`Club category doodle is unavailable: ${iconPath}`);
    }
    const colorizedSvg = sourceSvg.replaceAll("#1A1A1A", color);
    return `data:image/svg+xml;base64,${btoa(colorizedSvg)}`;
  });

  doodleIconDataUriCache.set(cacheKey, icons);
  return icons;
}
