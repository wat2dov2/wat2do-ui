import { collectPaginatedPages } from "@/shared/lib/pagination";
import type { ApiPaginatedPositionResponse } from "@/shared/generated";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { normalizePosition } from "@/features/positions/api/positionService";
import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { getServerApiBaseUrl } from "@/shared/services/serverApi";
import type { Position } from "@/shared/types";

export function positionDirectoryTag(school: string): string {
  return `position-directory-${resolveSchool(school)}`;
}

async function fetchPositionsPage(
  school: string,
  page: number,
  fetchOptions: RequestInit,
  clubId?: number,
): Promise<PaginatedPositionsResponse> {
  const params = new URLSearchParams({
    school,
    page: String(page),
    page_size: String(controlBox.eventDiscovery.serverFeedPageSize),
  });
  if (clubId != null) {
    params.set("club_id", String(clubId));
  }
  const response = await fetch(
    `${getServerApiBaseUrl()}/positions/?${params.toString()}`,
    fetchOptions,
  );

  if (!response.ok) {
    throw new Error(
      `Position directory request failed with status ${response.status}`,
    );
  }

  const directory = (await response.json()) as ApiPaginatedPositionResponse;
  return {
    ...directory,
    items: directory.items.map(normalizePosition),
  };
}

export async function getPositionDirectorySnapshot(
  school: string,
): Promise<PaginatedPositionsResponse> {
  const resolvedSchool = resolveSchool(school);
  const fetchOptions = positionDirectoryFetchOptions(resolvedSchool);
  return collectPaginatedPages((page) => fetchPositionsPage(resolvedSchool, page, fetchOptions));
}

function positionDirectoryFetchOptions(school: string): RequestInit {
  return {
    next: {
      revalidate:
        process.env.NODE_ENV === "development"
          ? 0
          : controlBox.eventDiscovery.feedRevalidateSeconds,
      tags: [positionDirectoryTag(school)],
    },
  };
}

/** Every currently open position for one club on its public page. */
export async function getClubPositionsSnapshot(
  clubId: number,
  school: string,
): Promise<Position[]> {
  const resolvedSchool = resolveSchool(school);
  const fetchOptions = positionDirectoryFetchOptions(resolvedSchool);
  const directory = await collectPaginatedPages((page) =>
    fetchPositionsPage(resolvedSchool, page, fetchOptions, clubId),
  );
  return directory.items;
}
