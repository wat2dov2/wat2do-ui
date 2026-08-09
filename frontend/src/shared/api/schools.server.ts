import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { getServerApiBaseUrl } from "@/shared/services/serverApi";
import {
  SCHOOL_DIRECTORY_LIMIT,
  type School,
  type SchoolSummary,
} from "@/shared/api/schools.api";

export const SCHOOL_DIRECTORY_TAG = "school-directory";

export function schoolBrandingTag(school: string): string {
  return `school-branding-${resolveSchool(school)}`;
}

export async function getSchool(school: string): Promise<School | null> {
  const slug = resolveSchool(school);
  const response = await fetch(`${getServerApiBaseUrl()}/schools/${encodeURIComponent(slug)}`, {
    next: {
      revalidate: controlBox.eventDiscovery.feedRevalidateSeconds,
      tags: [schoolBrandingTag(slug)],
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`School request failed with status ${response.status}`);
  }
  return (await response.json()) as School;
}

export async function getSchoolDirectory(): Promise<SchoolSummary[]> {
  const params = new URLSearchParams({
    q: "",
    limit: String(SCHOOL_DIRECTORY_LIMIT),
  });
  const response = await fetch(`${getServerApiBaseUrl()}/schools?${params.toString()}`, {
    next: {
      revalidate: controlBox.eventDiscovery.feedRevalidateSeconds,
      tags: [SCHOOL_DIRECTORY_TAG],
    },
  });

  if (!response.ok) {
    throw new Error(`School directory request failed with status ${response.status}`);
  }
  return (await response.json()) as SchoolSummary[];
}
