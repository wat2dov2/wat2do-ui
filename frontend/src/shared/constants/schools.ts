/** Default school slug used as a fallback throughout the app. */
export const DEFAULT_SCHOOL = "uwaterloo";

/** The canonical public origin for a school, matching the backend's captions. */
export function getSchoolPublicUrl(school: string | null | undefined): string {
  return `${resolveSchool(school)}.wat2do.io`;
}

function normalizeSchoolSlug(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

/** The first available school a newly created record belongs to. */
export function resolveWritableSchool(
  ...candidates: (string | null | undefined)[]
): string {
  for (const candidate of candidates) {
    if (candidate?.trim()) return resolveSchool(candidate);
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
    labels.length === 3 && labels[1] === "wat2do" && labels[2] === "localhost";

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

export interface HostnameSchoolStatus {
  school: string;
  candidate: string | null;
}

export function getHostnameSchoolStatus(hostname: string): HostnameSchoolStatus {
  const candidate = parseSchoolCandidateFromHostname(hostname);
  if (!candidate) {
    return {
      school: DEFAULT_SCHOOL,
      candidate: null,
    };
  }

  const school = resolveSchool(candidate);
  return {
    school,
    candidate,
  };
}

export function getCurrentSchool(): string {
  if (typeof window === "undefined") return DEFAULT_SCHOOL;
  return getHostnameSchoolStatus(window.location.hostname).school;
}

/** A school's campus clock, from the school directory keyed by slug. */
export function lookupSchoolTimezone(
  schoolBySlug: ReadonlyMap<string, { timezone: string }>,
  school: string | null | undefined,
): string {
  // Records without a school have no campus clock; label them explicitly in UTC.
  if (!school) return "UTC";
  const timezone = schoolBySlug.get(school)?.timezone;
  if (!timezone) throw new Error(`Missing timezone for school: ${school}`);
  return timezone;
}

/**
 * Resolve the school a request is scoped to from its Host header.
 *
 * Each school is served from its own subdomain, so the host is the only source
 * of truth for scoping. Hosts carrying a port (local dev) are handled.
 */
export function getSchoolFromRequestHost(host: string | null | undefined): string {
  const hostname = (host ?? "").split(":")[0];
  return getHostnameSchoolStatus(hostname).school;
}

/**
 * Whether `hostname` is one of wat2do's own sites (wat2do.io or the local
 * wat2do.localhost), where each school has its own subdomain. Other hosts, such
 * as a deployment preview or 127.0.0.1, serve every school from one address.
 */
export function isSchoolSiteHostname(hostname: string): boolean {
  const [domain, top] = hostname.toLowerCase().split(".").slice(-2);
  return domain === "wat2do" && (top === "io" || top === "localhost");
}

/**
 * Absolute origin serving a school, derived from the current location so it
 * works across production subdomains and `*.wat2do.localhost` dev hosts alike.
 */
export function getSchoolOrigin(school: string): string {
  const slug = resolveSchool(school);
  const { protocol, hostname, port } = window.location;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return `${protocol}//${slug}.wat2do.localhost${port ? `:${port}` : ""}`;
  }
  const labels = hostname.split(".");
  const baseLabels = parseSchoolCandidateFromHostname(hostname)
    ? labels.slice(1)
    : labels[0] === "www"
      ? labels.slice(1)
      : labels;
  const nextHost = [slug, ...baseLabels].join(".");
  return `${protocol}//${nextHost}${port ? `:${port}` : ""}`;
}
