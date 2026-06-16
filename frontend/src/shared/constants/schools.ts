/** Default school slug used as a fallback throughout the app. */
export const DEFAULT_SCHOOL = "uwaterloo";

const SCHOOL_LABELS: Record<string, string> = {
  all: "All Schools",
  uwaterloo: "University of Waterloo",
  utoronto: "University of Toronto",
  utsc: "University of Toronto Scarborough",
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

const SCHOOL_ALIASES: Record<string, string> = {
  "old-uw": DEFAULT_SCHOOL,
  "old-waterloo": DEFAULT_SCHOOL,
  "old-uwaterloo": DEFAULT_SCHOOL,
  "old-mit": "mit",
  "university-of-waterloo": DEFAULT_SCHOOL,
  "university of waterloo": DEFAULT_SCHOOL,
  "university of toronto": "utoronto",
  "university of toronto - st. george": "utoronto",
  "university of toronto scarborough": "utsc",
  "university of toronto - scarborough": "utsc",
  "mcgill university": "mcgill",
  "mcmaster university": "mcmaster",
  "western university": "western",
  "queen's university": "queens",
  "carleton university": "carleton",
  "brock university": "brock",
  "wilfrid laurier university": "wlu",
  "york university": "york",
  "toronto metropolitan university": "tmu",
  "university of ottawa": "uottawa",
  "ocad university": "ocad",
  "cornell university": "cornell",
  "new york university": "nyu",
  "university of pennsylvania": "upenn",
  "columbia university": "columbia",
  uw: DEFAULT_SCHOOL,
  waterloo: DEFAULT_SCHOOL,
  uwaterloo: DEFAULT_SCHOOL,
  "massachusetts-institute-of-technology": "mit",
  "massachusetts institute of technology": "mit",
  mit: "mit",
  "university of california, berkeley": "berkeley",
  "uc berkeley": "berkeley",
  berkeley: "berkeley",
};

function normalizeSchoolLabel(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function hasSchoolLabel(school: string): boolean {
  return Object.hasOwn(SCHOOL_LABELS, school) && school !== "all";
}

export function resolveSchool(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) return DEFAULT_SCHOOL;
  return SCHOOL_ALIASES[normalizeSchoolLabel(raw)] ?? raw;
}

function parseSchoolCandidateFromHostname(hostname: string): string | null {
  const labels = hostname
    .split(".")
    .map(normalizeSchoolLabel)
    .filter(Boolean);
  const isWat2DoHostname =
    labels.length >= 2 && labels[labels.length - 2] === "wat2do" && labels[labels.length - 1] === "io";

  if (!isWat2DoHostname || labels.length <= 2) {
    return null;
  }

  const oldIndex = labels.indexOf("old");
  const candidate = oldIndex >= 0 ? labels[oldIndex + 1] : labels[0];
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
  return SCHOOL_LABELS[resolveSchool(school)] ?? school;
}
