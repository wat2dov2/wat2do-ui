import type { ApiClubResponse } from "@/shared/generated";
import type { Club } from "@/shared/types";
import { normalizeInstagramHandle } from "@/shared/utils/url";

/** Ambiguous handles never silently assign a submission to the wrong club. */
export function resolveClubByInstagramHandle(clubs: Club[], value: string): Club | undefined {
  const handle = normalizeInstagramHandle(value).toLowerCase();
  if (!handle) return undefined;
  const matches = clubs.filter(club => normalizeInstagramHandle(club.ig).toLowerCase() === handle);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The clubs with an Instagram handle that match what was typed in a handle
 * field, best first: handles that start with it, then names with a word that
 * starts with it, then handles and names that contain it anywhere.
 */
export function suggestClubsByHandle(clubs: Club[], typed: string, limit: number): Club[] {
  const text = typed.trim().replace(/^@+/, "").toLowerCase();
  if (!text) return [];
  // A pasted profile link matches by its handle.
  const handleText = normalizeInstagramHandle(typed).toLowerCase() || text;
  const rank = (handle: string, name: string) => {
    if (handle.startsWith(handleText)) return 0;
    if (name.startsWith(text) || name.includes(` ${text}`)) return 1;
    if (handle.includes(handleText)) return 2;
    return name.includes(text) ? 3 : null;
  };
  return clubs
    .flatMap((club) => {
      const handle = normalizeInstagramHandle(club.ig).toLowerCase();
      const order = handle ? rank(handle, club.club_name.toLowerCase()) : null;
      return order === null ? [] : [{ club, handle, order }];
    })
    .sort((a, b) => a.order - b.order || a.handle.localeCompare(b.handle))
    .slice(0, limit)
    .map(({ club }) => club);
}

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
    school: raw.school ?? "",
    event_count: raw.event_count ?? 0,
    position_count: raw.position_count ?? 0,
    verified: raw.verified ?? false,
  };
}

/** Filter the complete cached directory without issuing per-filter requests. */
export function filterClubs(clubs: Club[], filters: {
  search: string;
  categories: string[];
  minEvents: number;
  ids?: number[];
  addedSince?: string | null;
}): Club[] {
  const search = filters.search.trim().toLowerCase();
  const handle = search.replace(/^@+/, "");
  const addedSince = filters.addedSince ? Date.parse(filters.addedSince) : null;
  const ids = filters.ids === undefined ? undefined : new Set(filters.ids);
  return clubs.filter((club) =>
    (!search || club.club_name.toLowerCase().includes(search) || (!!handle && (club.ig ?? "").toLowerCase().includes(handle))) &&
    (!filters.categories.length || filters.categories.some(category => club.categories.includes(category))) &&
    club.event_count >= filters.minEvents &&
    (!ids || ids.has(club.id)) &&
    (addedSince === null || Date.parse(club.created_at ?? "") >= addedSince),
  );
}
