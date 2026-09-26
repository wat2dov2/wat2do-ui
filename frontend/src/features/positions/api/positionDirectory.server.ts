import { readDiscoverySnapshot } from "@/shared/services/discoveryCache.server";
import { collectPaginatedPages } from "@/shared/lib/pagination";
import type { ApiPaginatedPositionResponse } from "@/shared/generated";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { normalizePosition } from "@/features/positions/api/positionService";
import { controlBox } from "@/shared/config/controlBox";
import { resolveSchool } from "@/shared/constants/schools";
import { fetchServerSnapshot, getServerApiBaseUrl } from "@/shared/services/serverApi";
import type { Position } from "@/shared/types";

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
  const response = await fetchServerSnapshot(
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

export async function buildPositionDirectorySnapshot(
  school: string,
): Promise<PaginatedPositionsResponse> {
  const resolvedSchool = resolveSchool(school);
  const fetchOptions: RequestInit = { cache: "no-store" };
  return collectPaginatedPages((page) => fetchPositionsPage(resolvedSchool, page, fetchOptions));
}

/** Every currently open position for one club on its public page. */
export async function getClubPositionsSnapshot(
  clubId: number,
  school: string,
): Promise<Position[]> {
  const resolvedSchool = resolveSchool(school);
  const fetchOptions: RequestInit = { cache: "no-store" };
  const directory = await collectPaginatedPages((page) =>
    fetchPositionsPage(resolvedSchool, page, fetchOptions, clubId),
  );
  return directory.items;
}

export async function getPositionDirectorySnapshot(school: string) {
  const slug = resolveSchool(school);
  return readDiscoverySnapshot(slug, "positions", () => buildPositionDirectorySnapshot(slug));
}
