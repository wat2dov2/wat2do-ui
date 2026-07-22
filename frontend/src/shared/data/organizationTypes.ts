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
const organizationTypes = {
  "arts-culture": {
    label: "Arts & Culture",
    color: "#FFB3C2",
    icon: "/icons/organization-types/arts-culture.svg",
  },
  business: {
    label: "Business",
    color: "#9BD9FF",
    icon: "/icons/organization-types/business.svg",
  },
  "community-service": {
    label: "Community Service",
    color: "#91E7C5",
    icon: "/icons/organization-types/community-service.svg",
  },
  environment: {
    label: "Environment",
    color: "#C9F840",
    icon: "/icons/organization-types/environment.svg",
  },
  "games-recreation": {
    label: "Games & Recreation",
    color: "#FFE94A",
    icon: "/icons/organization-types/games-recreation.svg",
  },
  health: {
    label: "Health",
    color: "#FF9E8F",
    icon: "/icons/organization-types/health.svg",
  },
  "media-web": {
    label: "Media & Web",
    color: "#A9C1FF",
    icon: "/icons/organization-types/media-web.svg",
  },
  "politics-advocacy": {
    label: "Politics & Advocacy",
    color: "#C5B8FF",
    icon: "/icons/organization-types/politics-advocacy.svg",
  },
  "religion-spirituality": {
    label: "Religion & Spirituality",
    color: "#FFBE8A",
    icon: "/icons/organization-types/religion-spirituality.svg",
  },
} as const;

export type OrganizationType = keyof typeof organizationTypes;

export interface OrganizationTypeConfig {
  label: string;
  color: string;
  icon: string;
}

/** Neutral config for unknown or malformed category values. */
const defaultOrganizationType: OrganizationTypeConfig = {
  label: "Organization",
  color: "#E8E8E8",
  icon: "/icons/organization-types/default.svg",
};

/**
 * Ink used for text and icons sitting on a category colour.
 *
 * Every colour above is a light pastel, so one dark ink is readable on all of
 * them. It is fixed rather than themed because the swatch it sits on is fixed.
 */
export const organizationTypeInk = "#1A1A1A";

/** Display label -> slug, so database category strings resolve to the registry. */
const SLUG_BY_LABEL: Record<string, OrganizationType> = Object.fromEntries(
  (Object.keys(organizationTypes) as OrganizationType[]).map((slug) => [
    normalizeKey(organizationTypes[slug].label),
    slug,
  ]),
) as Record<string, OrganizationType>;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Resolve any stored category string to a slug.
 * Accepts display labels ("Arts & Culture") and slugs ("arts-culture") alike.
 */
export function toOrganizationType(value: string | null | undefined): OrganizationType | null {
  if (!value) return null;
  const key = normalizeKey(value);
  if (Object.hasOwn(organizationTypes, key)) return key as OrganizationType;
  return SLUG_BY_LABEL[key] ?? null;
}

/** Registry entry for a category, falling back to the neutral config. */
export function getOrganizationTypeConfig(
  value: string | null | undefined,
): OrganizationTypeConfig {
  const slug = toOrganizationType(value);
  return slug ? organizationTypes[slug] : defaultOrganizationType;
}

/** All slugs in registry order, for previews and filters. */
export const ORGANIZATION_TYPE_SLUGS = Object.keys(organizationTypes) as OrganizationType[];
