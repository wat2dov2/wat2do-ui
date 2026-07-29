import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { getServerApiBaseUrl } from "@/shared/services/serverApi";
import type { School } from "@/shared/api/schools.api";

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
