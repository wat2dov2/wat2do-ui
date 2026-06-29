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

  if (!isWat2DoHostname || labels.length <= 2) {
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
