import { headers } from "next/headers";
import { readDiscoverySnapshot } from "@/shared/services/discoveryCache.server";
import { getSchoolFromRequestHost, resolveSchool } from "@/shared/constants/schools";
import {
  fetchServerSnapshot,
  getServerApiBaseUrl,
} from "@/shared/services/serverApi";
import {
  SCHOOL_DIRECTORY_LIMIT,
  type School,
  type SchoolSummary,
} from "@/shared/api/schools.api";

/** Each school is served from its own subdomain, so the Host header scopes a request. */
export async function getRequestSchool(): Promise<string> {
  const requestHeaders = await headers();
  return getSchoolFromRequestHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
}

export async function buildSchoolSnapshot(
  school: string,
): Promise<School | null> {
  const slug = resolveSchool(school);
  const response = await fetchServerSnapshot(
    `${getServerApiBaseUrl()}/schools/${encodeURIComponent(slug)}`,
    {
      cache: "no-store",
    },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`School request failed with status ${response.status}`);
  }
  return (await response.json()) as School;
}

export async function buildSchoolDirectorySnapshot(): Promise<SchoolSummary[]> {
  const params = new URLSearchParams({
    q: "",
    limit: String(SCHOOL_DIRECTORY_LIMIT),
  });
  const response = await fetchServerSnapshot(
    `${getServerApiBaseUrl()}/schools?${params.toString()}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(
      `School directory request failed with status ${response.status}`,
    );
  }
  const schools = (await response.json()) as SchoolSummary[];
  if (schools.length >= SCHOOL_DIRECTORY_LIMIT)
    throw new Error(
      "School directory may be truncated; increase the directory contract before enrolling more schools",
    );
  return schools;
}

export async function getSchool(school: string): Promise<School | null> {
  const slug = resolveSchool(school);
  return readDiscoverySnapshot(slug, "branding", () =>
    buildSchoolSnapshot(slug),
  );
}

export async function getSchoolDirectory(): Promise<SchoolSummary[]> {
  return readDiscoverySnapshot(
    "_global",
    "schools",
    buildSchoolDirectorySnapshot,
  );
}

/**
 * The directory a page hands the browser on `requestSchool`'s site. A school's
 * campus seasons (about 7 KB each, labelled in every language) only matter on
 * that school's own site, so every other school goes without them; shipping
 * all of them added about 140 KB to every page's HTML.
 */
export async function getSchoolDirectoryForPage(
  requestSchool: string,
): Promise<SchoolSummary[]> {
  const schools = await getSchoolDirectory();
  return schools.map((school) => {
    if (school.slug === requestSchool) return school;
    const summary = { ...school };
    delete summary.event_seasons;
    return summary;
  });
}
