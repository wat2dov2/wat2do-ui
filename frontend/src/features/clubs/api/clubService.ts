import type { ApiClubResponse } from "@/shared/generated";
import type { Club } from "@/shared/types";

export function normalizeClub(
  raw: ApiClubResponse,
): Club {
  return {
    ...raw,
    categories: raw.categories ?? [],
    club_page: raw.club_page ?? "",
    ig: raw.ig ?? null,
    discord: raw.discord ?? null,
    logo_url: raw.logo_url ?? null,
    created_by: raw.created_by ?? null,
    school: raw.school ?? "",
    event_count: raw.event_count ?? 0,
    position_count: raw.position_count ?? 0,
  };
}

/** Filter the complete cached directory without issuing per-filter requests. */
export function filterClubs(clubs: Club[], filters: {
  search: string;
  categories: string[];
  minEvents: number;
  ids?: number[];
}): Club[] {
  const search = filters.search.trim().toLowerCase();
  const ids = filters.ids === undefined ? undefined : new Set(filters.ids);
  return clubs.filter((club) =>
    (!search || club.club_name.toLowerCase().includes(search)) &&
    (!filters.categories.length || filters.categories.some(category => club.categories.includes(category))) &&
    club.event_count >= filters.minEvents &&
    (!ids || ids.has(club.id)),
  );
}
