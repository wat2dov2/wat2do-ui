import type { ApiPositionResponse } from "@/shared/generated";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import type { Position, PositionType } from "@/shared/types";

export function normalizePosition(raw: ApiPositionResponse): Position {
  return {
    ...raw,
    requirements: raw.requirements ?? [],
  };
}

/** One complete directory for both server hydration and browser cache reads. */
export async function collectPositionPages(
  fetchPage: (page: number) => Promise<PaginatedPositionsResponse>,
): Promise<PaginatedPositionsResponse> {
  const firstPage = await fetchPage(1);
  const remainingPages = await Promise.all(
    Array.from({ length: Math.max(firstPage.total_pages - 1, 0) }, (_, index) =>
      fetchPage(index + 2),
    ),
  );
  const items = [...new Map(
    [firstPage, ...remainingPages]
      .flatMap((page) => page.items)
      .map((item) => [item.id, item]),
  ).values()];
  return {
    ...firstPage,
    items,
    total: items.length,
    page: 1,
    page_size: items.length,
    total_pages: 1,
  };
}

/** Filter the complete cached directory without making requests. */
export function filterPositions(
  positions: Position[],
  filters: {
    search: string;
    positionType: PositionType | "all";
    paidOnly: boolean;
    addedSince: string | null;
  },
  now = Date.now(),
): Position[] {
  const search = filters.search.trim().toLowerCase();
  const today = new Date(now).toISOString().slice(0, 10);
  return positions.filter((position) => {
    // A long-lived snapshot must not keep showing roles after their deadline.
    if (!position.is_active || (position.deadline_date && position.deadline_date < today)) {
      return false;
    }
    if (filters.positionType !== "all" && position.position_type !== filters.positionType) {
      return false;
    }
    if (filters.paidOnly && !position.is_paid) {
      return false;
    }
    if (
      filters.addedSince &&
      !(Date.parse(position.added_at) >= Date.parse(filters.addedSince))
    ) {
      return false;
    }
    return !search || [position.title, position.description, position.commitment, position.location]
      .some((value) => value?.toLowerCase().includes(search));
  });
}
