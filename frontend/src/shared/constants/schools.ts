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
