/** Default school slug used as a fallback throughout the app. */
export const DEFAULT_SCHOOL = "uwaterloo";

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
  cornell: "Cornell University",
  nyu: "New York University",
  upenn: "University of Pennsylvania",
  columbia: "Columbia University",
  mit: "MIT",
  ubc: "University of British Columbia",
  berkeley: "UC Berkeley",
};

export const SCHOOL_SLUGS = Object.keys(SCHOOL_LABELS).filter(
  (school) => school !== "all",
);

function normalizeSchoolSlug(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function hasSchoolLabel(school: string): boolean {
  return Object.hasOwn(SCHOOL_LABELS, school) && school !== "all";
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
  isKnownSchool: boolean;
}

export function getHostnameSchoolStatus(hostname: string): HostnameSchoolStatus {
  const candidate = parseSchoolCandidateFromHostname(hostname);
  if (!candidate) {
    return {
      school: DEFAULT_SCHOOL,
      candidate: null,
      isKnownSchool: true,
    };
  }

  const school = resolveSchool(candidate);
  return {
    school,
    candidate,
    isKnownSchool: isKnownSchool(school),
  };
}

export function getCurrentSchool(): string {
  if (typeof window === "undefined") return DEFAULT_SCHOOL;
  return getHostnameSchoolStatus(window.location.hostname).school;
}

export function getSchoolDisplayName(school: string): string {
  const slug = resolveSchool(school);
  return SCHOOL_LABELS[slug] ?? slug;
}

/**
 * The student association a school's organizations can affiliate with, for the
 * affiliation badge. Presentation only - whether a given organization is
 * affiliated is the `association_affiliated` flag on the API response.
 *
 * Static per-school metadata, mirroring how the backend keeps display name and
 * timezone in `core/constants/school_mappings.py` rather than the database.
 * A school with no entry here simply renders no badge.
 */
export interface StudentAssociation {
  /** Short name shown to screen readers, e.g. "WUSA". */
  shortName: string;
  /** Wordmark in `public/`, used as a mask so it inherits `currentColor`. */
  wordmarkUrl: string;
}

/*
 * Waterloo uses WUSA's supplied wordmark. Every other entry is a plain type
 * treatment of the association's acronym generated into `public/associations`,
 * not a reproduction of that organization's official logo - swap in the real
 * asset when a school provides one.
 */
const SCHOOL_ASSOCIATIONS: Record<string, StudentAssociation> = {
  uwaterloo: { shortName: "WUSA", wordmarkUrl: "/wusa-wordmark.png" },
  utoronto: { shortName: "UTSU", wordmarkUrl: "/associations/utoronto.svg" },
  utsc: { shortName: "SCSU", wordmarkUrl: "/associations/utsc.svg" },
  utm: { shortName: "UTMSU", wordmarkUrl: "/associations/utm.svg" },
  mcgill: { shortName: "SSMU", wordmarkUrl: "/associations/mcgill.svg" },
  mcmaster: { shortName: "MSU", wordmarkUrl: "/associations/mcmaster.svg" },
  western: { shortName: "USC", wordmarkUrl: "/associations/western.svg" },
  queens: { shortName: "AMS", wordmarkUrl: "/associations/queens.svg" },
  carleton: { shortName: "CUSA", wordmarkUrl: "/associations/carleton.svg" },
  brock: { shortName: "BUSU", wordmarkUrl: "/associations/brock.svg" },
  wlu: { shortName: "WLUSU", wordmarkUrl: "/associations/wlu.svg" },
  york: { shortName: "YFS", wordmarkUrl: "/associations/york.svg" },
  tmu: { shortName: "TMSU", wordmarkUrl: "/associations/tmu.svg" },
  uottawa: { shortName: "UOSU", wordmarkUrl: "/associations/uottawa.svg" },
  ocad: { shortName: "OCADSU", wordmarkUrl: "/associations/ocad.svg" },
  cornell: { shortName: "SA", wordmarkUrl: "/associations/cornell.svg" },
  nyu: { shortName: "SGA", wordmarkUrl: "/associations/nyu.svg" },
  upenn: { shortName: "UA", wordmarkUrl: "/associations/upenn.svg" },
  columbia: { shortName: "CCSC", wordmarkUrl: "/associations/columbia.svg" },
  mit: { shortName: "UA", wordmarkUrl: "/associations/mit.svg" },
  ubc: { shortName: "AMS", wordmarkUrl: "/associations/ubc.svg" },
  berkeley: { shortName: "ASUC", wordmarkUrl: "/associations/berkeley.svg" },
};

/** School slugs that have a student association registered, for previews. */
export const SCHOOLS_WITH_ASSOCIATIONS = Object.keys(SCHOOL_ASSOCIATIONS);

/** The school's student association, or null when the school has none registered. */
export function getStudentAssociation(school: string | null | undefined): StudentAssociation | null {
  return SCHOOL_ASSOCIATIONS[resolveSchool(school)] ?? null;
}
