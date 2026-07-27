/** Default school slug used as a fallback throughout the app. */
export const DEFAULT_SCHOOL = "uwaterloo";

/**
 * The all-schools scope, served from its own origin like any school.
 *
 * It is a viewing lens for admins, never a school an event or a user belongs
 * to - so it is a servable host but not a known school.
 */
export const ALL_SCHOOLS = "all";

const SCHOOL_LABELS: Record<string, string> = {
  all: "All Schools",
  uwaterloo: "University of Waterloo",
  utoronto: "University of Toronto",
  utsc: "University of Toronto Scarborough",
  utm: "University of Toronto Mississauga",
  mcgill: "McGill University",
  mcmaster: "McMaster University",
  western: "Western University",
  queens: "Queen's University",
  carleton: "Carleton University",
  brock: "Brock University",
  wlu: "Wilfrid Laurier University",
  york: "York University",
  tmu: "Toronto Metropolitan University",
  uottawa: "University of Ottawa",
  ocad: "OCAD University",
  ualberta: "University of Alberta",
  laval: "Université Laval",
  memorial: "Memorial University",
  sfu: "Simon Fraser University",
  udem: "Université de Montréal",
  umanitoba: "University of Manitoba",
  concordia: "Concordia University",
  dalhousie: "Dalhousie University",
  guelph: "University of Guelph",
  ucalgary: "University of Calgary",
  usask: "University of Saskatchewan",
  uvic: "University of Victoria",
  windsor: "University of Windsor",
  uqam: "Université du Québec à Montréal",
  ontariotech: "Ontario Tech University",
  cornell: "Cornell University",
  nyu: "New York University",
  upenn: "University of Pennsylvania",
  columbia: "Columbia University",
  mit: "MIT",
  ubc: "University of British Columbia",
  berkeley: "UC Berkeley",
};

/**
 * Each school's brand pair, used to theme generated artwork.
 *
 * `primary` is the field the artwork sits on and `ink` is what reads on top of
 * it, so the two must always clear WCAG AA against each other. Slugs missing
 * here fall back to the Wat2Do pair, which is why this map only needs a row
 * once a school's own colours are known.
 *
 * This lives beside the display names rather than in Supabase on purpose:
 * migration 20260629160000 moved school metadata out of the DB, and the only
 * readers - the carousel cover preview and the satori render route - are both
 * frontend, so a column would buy a round trip and nothing else.
 */
const WAT2DO_COLORS: SchoolColors = { primary: "#FFC629", ink: "#111111" };

export interface SchoolColors {
  /** Field colour: large flat areas and the accent rules on top of ink. */
  primary: string;
  /** Everything that has to read against `primary`. */
  ink: string;
}

const SCHOOL_COLORS: Record<string, SchoolColors> = {
  uwaterloo: { primary: "#FFD54F", ink: "#111111" },
  utoronto: { primary: "#002A5C", ink: "#FFFFFF" },
  utsc: { primary: "#00A189", ink: "#0B231E" },
  utm: { primary: "#0F4D92", ink: "#FFFFFF" },
  mcgill: { primary: "#ED1B2F", ink: "#FFFFFF" },
  mcmaster: { primary: "#7A003C", ink: "#FDBF57" },
  western: { primary: "#4F2683", ink: "#FFFFFF" },
  queens: { primary: "#B90E31", ink: "#FFFFFF" },
  carleton: { primary: "#C8102E", ink: "#FFFFFF" },
  brock: { primary: "#CC0000", ink: "#FFFFFF" },
  wlu: { primary: "#4B2E39", ink: "#FFC72C" },
  york: { primary: "#E31837", ink: "#FFFFFF" },
  tmu: { primary: "#004C9B", ink: "#FFFFFF" },
  uottawa: { primary: "#8A1538", ink: "#FFFFFF" },
  ocad: { primary: "#000000", ink: "#FFFFFF" },
  ualberta: { primary: "#007C41", ink: "#FFDB05" },
  laval: { primary: "#DA291C", ink: "#FFFFFF" },
  memorial: { primary: "#8C2332", ink: "#FFFFFF" },
  sfu: { primary: "#A6192E", ink: "#FFFFFF" },
  udem: { primary: "#0057B8", ink: "#FFFFFF" },
  umanitoba: { primary: "#7A003C", ink: "#FFFFFF" },
  concordia: { primary: "#912338", ink: "#FFFFFF" },
  dalhousie: { primary: "#000000", ink: "#FFCC00" },
  guelph: { primary: "#C20430", ink: "#FFFFFF" },
  ucalgary: { primary: "#D6001C", ink: "#FFFFFF" },
  usask: { primary: "#006F3C", ink: "#FFFFFF" },
  uvic: { primary: "#005493", ink: "#F5AA1C" },
  windsor: { primary: "#0057B7", ink: "#FFFFFF" },
  uqam: { primary: "#009A44", ink: "#FFFFFF" },
  ontariotech: { primary: "#003C71", ink: "#FFFFFF" },
  cornell: { primary: "#B31B1B", ink: "#FFFFFF" },
  nyu: { primary: "#57068C", ink: "#FFFFFF" },
  upenn: { primary: "#011F5B", ink: "#FFFFFF" },
  columbia: { primary: "#B9D9EB", ink: "#0B2B3C" },
  mit: { primary: "#A31F34", ink: "#FFFFFF" },
  ubc: { primary: "#002145", ink: "#FFFFFF" },
  berkeley: { primary: "#003262", ink: "#FDB515" },
};

/** The brand pair generated artwork should use for a school. */
export function getSchoolColors(school: string | null | undefined): SchoolColors {
  return SCHOOL_COLORS[resolveSchool(school)] ?? WAT2DO_COLORS;
}

/** The canonical public origin for a school, matching the backend's captions. */
export function getSchoolPublicUrl(school: string | null | undefined): string {
  return `${resolveSchool(school)}.wat2do.io`;
}

function normalizeSchoolSlug(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function hasSchoolLabel(school: string): boolean {
  return Object.hasOwn(SCHOOL_LABELS, school) && school !== ALL_SCHOOLS;
}

export function isAllSchools(value: string | null | undefined): boolean {
  return resolveSchool(value) === ALL_SCHOOLS;
}

/**
 * The school a newly created record belongs to.
 *
 * The all-schools view is a lens, never an owner: an event or organization
 * created while looking through it belongs to the first real school in
 * ``candidates`` - typically the viewer's own.
 */
export function resolveWritableSchool(
  ...candidates: (string | null | undefined)[]
): string {
  for (const candidate of candidates) {
    const slug = candidate ? resolveSchool(candidate) : "";
    if (slug && slug !== ALL_SCHOOLS) return slug;
  }
  return DEFAULT_SCHOOL;
}

/** Normalize a school slug. Empty input falls back to the default school. */
export function resolveSchool(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) return DEFAULT_SCHOOL;
  return normalizeSchoolSlug(raw);
}

function parseSchoolCandidateFromHostname(hostname: string): string | null {
  const labels = hostname
    .split(".")
    .map(normalizeSchoolSlug)
    .filter(Boolean);
  const isWat2DoHostname =
    labels.length >= 2 && labels[labels.length - 2] === "wat2do" && labels[labels.length - 1] === "io";
  const isSchoolLocalhost =
    labels.length === 2 && labels[labels.length - 1] === "localhost";

  if (
    (!isWat2DoHostname && !isSchoolLocalhost) ||
    (isWat2DoHostname && labels.length <= 2)
  ) {
    return null;
  }

  const candidate = labels[0];
  if (
    !candidate ||
    candidate === "localhost" ||
    candidate === "127" ||
    candidate === "0" ||
    candidate === "wat2do" ||
    candidate === "www"
  ) {
    return null;
  }

  return candidate;
}

export function isKnownSchool(value: string | null | undefined): boolean {
  return hasSchoolLabel(resolveSchool(value));
}

export interface HostnameSchoolStatus {
  school: string;
  candidate: string | null;
  /** Whether the app serves this host: a real school, or the all-schools view. */
  isServable: boolean;
}

export function getHostnameSchoolStatus(hostname: string): HostnameSchoolStatus {
  const candidate = parseSchoolCandidateFromHostname(hostname);
  if (!candidate) {
    return {
      school: DEFAULT_SCHOOL,
      candidate: null,
      isServable: true,
    };
  }

  const school = resolveSchool(candidate);
  return {
    school,
    candidate,
    isServable: isKnownSchool(school) || school === ALL_SCHOOLS,
  };
}

export function getCurrentSchool(): string {
  if (typeof window === "undefined") return DEFAULT_SCHOOL;
  return getHostnameSchoolStatus(window.location.hostname).school;
}

/**
 * Resolve the school a request is scoped to from its Host header.
 *
 * Each school is served from its own subdomain, so the host is the only source
 * of truth for scoping. Hosts carrying a port (local dev) are handled.
 */
export function getSchoolFromRequestHost(host: string | null | undefined): string {
  const hostname = (host ?? "").split(":")[0];
  const status = getHostnameSchoolStatus(hostname);
  return status.isServable ? status.school : DEFAULT_SCHOOL;
}

/**
 * Absolute origin serving a school, derived from the current location so it
 * works across production subdomains and `*.localhost` dev hosts alike.
 */
export function getSchoolOrigin(school: string): string {
  const slug = resolveSchool(school);
  const { protocol, hostname, port } = window.location;
  const labels = hostname.split(".");
  const baseLabels = parseSchoolCandidateFromHostname(hostname)
    ? labels.slice(1)
    : labels[0] === "www"
      ? labels.slice(1)
      : labels;
  const nextHost = [slug, ...baseLabels].join(".");
  return `${protocol}//${nextHost}${port ? `:${port}` : ""}`;
}

export function getSchoolDisplayName(school: string): string {
  const slug = resolveSchool(school);
  return SCHOOL_LABELS[slug] ?? slug;
}
