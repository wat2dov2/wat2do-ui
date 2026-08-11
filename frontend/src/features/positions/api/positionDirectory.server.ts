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
  organizationId?: number,
): Promise<PaginatedPositionsResponse> {
  const params = new URLSearchParams({ school, page: String(page) });
  if (organizationId != null) {
    params.set("organization_id", String(organizationId));
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
  return fetchPositionsPage(
    resolvedSchool,
    1,
    positionDirectoryFetchOptions(resolvedSchool),
  );
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

/** Every currently open position for one organization on its public page. */
export async function getOrganizationPositionsSnapshot(
  organizationId: number,
  school: string,
): Promise<Position[]> {
  const resolvedSchool = resolveSchool(school);
  const fetchOptions = positionDirectoryFetchOptions(resolvedSchool);
  const firstPage = await fetchPositionsPage(
    resolvedSchool,
    1,
    fetchOptions,
    organizationId,
  );
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(firstPage.total_pages - 1, 0) }, (_, index) =>
      fetchPositionsPage(
        resolvedSchool,
        index + 2,
        fetchOptions,
        organizationId,
      ),
    ),
  );

  return [firstPage, ...remainingPages].flatMap((page) => page.items);
}
