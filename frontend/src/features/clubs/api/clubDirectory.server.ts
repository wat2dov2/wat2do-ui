import type { ApiClubResponse, ApiPaginatedClubsResponse } from "@/shared/generated";
import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { getServerApiBaseUrl } from "@/shared/services/serverApi";
import { normalizeClub } from "@/features/clubs/api/clubService";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";
import type { Club } from "@/shared/types";

export function clubDirectoryTag(school: string): string {
  return `club-directory-${resolveSchool(school)}`;
}

/** Public club detail shared by route metadata, initial HTML, and hydration. */
export async function getClubDetailSnapshot(
  clubId: number,
): Promise<Club | null> {
  const response = await fetch(
    `${getServerApiBaseUrl()}/clubs/${encodeURIComponent(String(clubId))}`,
    {
      next: {
        revalidate:
          process.env.NODE_ENV === "development"
            ? 0
            : controlBox.clubManagement.directoryRevalidateSeconds,
      },
    },
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

export async function getClubDirectorySnapshot(
  school: string,
): Promise<PaginatedClubsResponse> {
  const resolvedSchool = resolveSchool(school);
  const firstPage = await fetchClubDirectoryPage(resolvedSchool, 1);
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(firstPage.total_pages - 1, 0) }, (_, index) =>
      fetchClubDirectoryPage(resolvedSchool, index + 2),
    ),
  );
  const items = [firstPage, ...remainingPages].flatMap((page) => page.items);
  return { items, total: items.length, page: 1, page_size: items.length, total_pages: 1 };
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
  const response = await fetch(
    `${getServerApiBaseUrl()}/clubs/?${params.toString()}`,
    {
      next: {
        revalidate:
          process.env.NODE_ENV === "development"
            ? 0
            : controlBox.clubManagement.directoryRevalidateSeconds,
        tags: [clubDirectoryTag(school)],
      },
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
