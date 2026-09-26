import type { ApiPositionResponse } from "@/shared/generated";
import type { Position, PositionType } from "@/shared/types";

export function normalizePosition(raw: ApiPositionResponse): Position {
  return {
    ...raw,
    requirements: raw.requirements ?? [],
  };
}

/** Filter the complete cached directory without making requests. */
export function filterPositions(
  positions: Position[],
  filters: {
    search: string;
    positionType: PositionType | "all";
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
