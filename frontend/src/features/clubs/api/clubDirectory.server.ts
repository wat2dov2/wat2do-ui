import { readDiscoverySnapshot } from "@/shared/services/discoveryCache.server";
import { collectPaginatedPages } from "@/shared/lib/pagination";
import type { ApiClubResponse, ApiPaginatedClubsResponse } from "@/shared/generated";
import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { fetchServerSnapshot, getServerApiBaseUrl } from "@/shared/services/serverApi";
import { normalizeClub } from "@/features/clubs/api/clubService";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";
import type { Club } from "@/shared/types";

/** Public club detail shared by route metadata, initial HTML, and hydration. */
export async function getClubDetailSnapshot(
  clubId: number,
): Promise<Club | null> {
  const response = await fetchServerSnapshot(
    `${getServerApiBaseUrl()}/clubs/${encodeURIComponent(String(clubId))}`,
    { cache: "no-store" },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(
      `Club detail request failed with status ${response.status}`,
    );
  }

  return normalizeClub(
    (await response.json()) as ApiClubResponse,
  );
}

export async function buildClubDirectorySnapshot(
  school: string,
): Promise<PaginatedClubsResponse> {
  const resolvedSchool = resolveSchool(school);
  return collectPaginatedPages((page) => fetchClubDirectoryPage(resolvedSchool, page));
}

async function fetchClubDirectoryPage(
  school: string,
  page: number,
): Promise<PaginatedClubsResponse> {
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(controlBox.clubManagement.directoryPageSize),
    school,
  });
  const response = await fetchServerSnapshot(
    `${getServerApiBaseUrl()}/clubs/?${params.toString()}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Club directory request failed with status ${response.status}`,
    );
  }

  const directory = (await response.json()) as ApiPaginatedClubsResponse;
  return {
    ...directory,
    items: directory.items.map(normalizeClub),
  };
}

export async function getClubDirectorySnapshot(school: string) {
  const slug = resolveSchool(school);
  return readDiscoverySnapshot(slug, "clubs", () => buildClubDirectorySnapshot(slug));
}
