/**
 * The nine supported organization categories.
 *
 * Single source of truth for a category's label, card colour, and icon. Colour
 * is semantic and stable: every organization in a category renders identically,
 * with no hashing and no per-component conditionals. Keyed by slug so the
 * registry key, the colour, and the SVG filename are always the same string.
 *
 * Event cards deliberately do NOT use this - they keep their own category
 * palette in `shared/utils/event.ts`.
 */
const organizationCategoryStyles = {
  "arts-culture": {
    label: "Arts & Culture",
    color: "#FFB3C2",
    icon: "/icons/organization-categories/arts-culture.svg",
  },
  business: {
    label: "Business",
    color: "#9BD9FF",
    icon: "/icons/organization-categories/business.svg",
  },
  "community-service": {
    label: "Community Service",
    color: "#91E7C5",
    icon: "/icons/organization-categories/community-service.svg",
  },
  environment: {
    label: "Environment",
    color: "#C9F840",
    icon: "/icons/organization-categories/environment.svg",
  },
  "games-recreation": {
    label: "Games & Recreation",
    color: "#FFE94A",
    icon: "/icons/organization-categories/games-recreation.svg",
  },
  health: {
    label: "Health",
    color: "#FF9E8F",
    icon: "/icons/organization-categories/health.svg",
  },
  "media-web": {
    label: "Media & Web",
    color: "#A9C1FF",
    icon: "/icons/organization-categories/media-web.svg",
  },
  "politics-advocacy": {
    label: "Politics & Advocacy",
    color: "#C5B8FF",
    icon: "/icons/organization-categories/politics-advocacy.svg",
  },
  "religion-spirituality": {
    label: "Religion & Spirituality",
    color: "#FFBE8A",
    icon: "/icons/organization-categories/religion-spirituality.svg",
  },
} as const;

type OrganizationCategoryStyle = keyof typeof organizationCategoryStyles;

export interface OrganizationCategoryConfig {
  label: string;
  color: string;
  icon: string;
}

/** Neutral config for unknown or malformed category values. */
const defaultOrganizationCategory: OrganizationCategoryConfig = {
  label: "Organization",
  color: "#E8E8E8",
  icon: "/icons/organization-categories/default.svg",
};

/**
 * Ink used for text and icons sitting on a category colour.
 *
 * Every colour above is a light pastel, so one dark ink is readable on all of
 * them. It is fixed rather than themed because the swatch it sits on is fixed.
 */
export const organizationCategoryInk = "#1A1A1A";

/** Display label -> slug, so database category strings resolve to the registry. */
const SLUG_BY_LABEL: Record<string, OrganizationCategoryStyle> = Object.fromEntries(
  (Object.keys(organizationCategoryStyles) as OrganizationCategoryStyle[]).map((slug) => [
    normalizeKey(organizationCategoryStyles[slug].label),
    slug,
  ]),
) as Record<string, OrganizationCategoryStyle>;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Resolve any stored category string to a presentation-style slug.
 * Accepts display labels ("Arts & Culture") and slugs ("arts-culture") alike.
 */
function toOrganizationCategoryStyle(
  value: string | null | undefined,
): OrganizationCategoryStyle | null {
  if (!value) return null;
  const key = normalizeKey(value);
  if (Object.hasOwn(organizationCategoryStyles, key)) return key as OrganizationCategoryStyle;
  return SLUG_BY_LABEL[key] ?? null;
}

/** Registry entry for a category, falling back to the neutral config. */
export function getOrganizationCategoryConfig(
  value: string | null | undefined,
): OrganizationCategoryConfig {
  const slug = toOrganizationCategoryStyle(value);
  return slug ? organizationCategoryStyles[slug] : defaultOrganizationCategory;
}

/** All slugs in registry order, for previews and filters. */
export const ORGANIZATION_CATEGORY_STYLE_SLUGS = Object.keys(
  organizationCategoryStyles,
) as OrganizationCategoryStyle[];

const rawDoodleSvgs = JSON.parse(
  process.env.NEXT_PUBLIC_ORGANIZATION_CATEGORY_DOODLE_SVGS ?? "{}",
) as Record<string, string>;
const doodleIconSequenceCache = new Map<number, string[]>();
const doodleIconDataUriCache = new Map<string, string[]>();

/**
 * A balanced, stable shuffle of the category icons for decorative fields.
 *
 * The same count always produces the same arrangement on server and client,
 * and every icon is used evenly before any icon is repeated again.
 */
export function getOrganizationCategoryDoodleIcons(count: number): string[] {
  const cachedIcons = doodleIconSequenceCache.get(count);
  if (cachedIcons) return cachedIcons;

  const options = ORGANIZATION_CATEGORY_STYLE_SLUGS.map(
    (slug) => organizationCategoryStyles[slug].icon,
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
export function getOrganizationCategoryDoodleDataUris(
  color: string,
  count: number,
): string[] {
  const cacheKey = `${color}:${count}`;
  const cachedIcons = doodleIconDataUriCache.get(cacheKey);
  if (cachedIcons) return cachedIcons;

  const icons = getOrganizationCategoryDoodleIcons(count).map((iconPath) => {
    const sourceSvg = rawDoodleSvgs[iconPath];
    if (!sourceSvg) {
      throw new Error(`Organization category doodle is unavailable: ${iconPath}`);
    }
    const colorizedSvg = sourceSvg.replaceAll("#1A1A1A", color);
    return `data:image/svg+xml;base64,${btoa(colorizedSvg)}`;
  });

  doodleIconDataUriCache.set(cacheKey, icons);
  return icons;
}
