import type { ApiEventSummaryResponse } from "@/shared/generated";

/** One club in a club badge's menu. */
export interface ClubBadgeMenuClub {
  id: number;
  name: string;
  logoUrl: string | null;
}

interface ClubBadgeHost {
  id?: number | null;
  name: string;
  logoUrl?: string | null;
}

/**
 * The clubs a host badge's menu lists: the host first, then each cohost.
 * Empty when the badge stands for one club, or its host has no page to open,
 * so the badge links straight to that club instead.
 */
export function clubBadgeMenuClubs(
  host: ClubBadgeHost,
  cohosts: NonNullable<ApiEventSummaryResponse["cohosts"]>,
): ClubBadgeMenuClub[] {
  if (!host.id || !host.name || cohosts.length === 0) return [];
  return [
    { id: host.id, name: host.name, logoUrl: host.logoUrl ?? null },
    ...cohosts.map((club) => ({ id: club.id, name: club.club_name, logoUrl: club.logo_url ?? null })),
  ];
}
