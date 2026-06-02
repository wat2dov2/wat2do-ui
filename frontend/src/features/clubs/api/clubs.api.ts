/**
 * Clubs API
 * All clubs come from the backend. No mock/static data.
 */

import type { Club } from "@/shared/types";
import type { ApiClubResponse } from "@/shared/generated";
import { api } from "@/shared/services/apiClient";
import {
  filterClubsBySearch,
  filterClubsByCategory,
  filterClubsByType,
} from "@/features/clubs/api/clubService";

const CLUBS_LIST_LIMIT = 500;

function normalizeClub(club: ApiClubResponse): Club {
  return {
    ...club,
    categories: club.categories ?? [],
    club_page: club.club_page ?? "",
    ig: club.ig ?? null,
    discord: club.discord ?? null,
    logo_url: club.logo_url ?? null,
    created_by: club.created_by ?? null,
    school: club.school ?? "",
  };
}

export async function getAllClubs(school?: string): Promise<Club[]> {
  const params = new URLSearchParams();
  params.set("limit", String(CLUBS_LIST_LIMIT));
  if (school) {
    params.set("school", school);
  }
  const clubs = await api.get<ApiClubResponse[]>(`/clubs/?${params.toString()}`);
  return clubs.map(normalizeClub);
}

export async function getMyClubs(): Promise<Club[]> {
  const clubs = await api.get<ApiClubResponse[]>("/clubs/mine");
  return clubs.map(normalizeClub);
}

export async function createClubAPI(clubData: Omit<Club, "id">): Promise<Club> {
  const { created_by, ...payload } = clubData;
  const club = await api.post<ApiClubResponse>("/clubs/", {
    ...payload,
    owner_user_id: created_by || undefined,
  });
  return normalizeClub(club);
}

export async function updateClubAPI(
  club: Club,
  clubData: Partial<Omit<Club, "id">>,
): Promise<Club> {
  const payload = { ...clubData };
  delete payload.created_by;
  const updated = await api.patch<ApiClubResponse>(`/clubs/${club.id}`, payload);
  return normalizeClub(updated);
}

export async function deleteClubAPI(clubId: number): Promise<void> {
  await api.delete(`/clubs/${clubId}`);
}

export function filterClubs(
  clubs: Club[],
  options: { categories?: string[]; clubType?: string; searchQuery?: string },
): Club[] {
  let filtered = clubs;
  if (options.searchQuery) filtered = filterClubsBySearch(filtered, options.searchQuery);
  if (options.categories?.length) filtered = filterClubsByCategory(filtered, options.categories);
  if (options.clubType) filtered = filterClubsByType(filtered, options.clubType);
  return filtered;
}

async function getClubCategories(existingClubs?: Club[]): Promise<string[]> {
  const clubs = existingClubs ?? await getAllClubs();
  const cats = new Set<string>();
  clubs.forEach((c) => c.categories.forEach((cat) => cats.add(cat)));
  return Array.from(cats).sort();
}

export async function getClubTypes(existingClubs?: Club[]): Promise<string[]> {
  const clubs = existingClubs ?? await getAllClubs();
  const types = new Set<string>();
  clubs.forEach((c) => {
    const type = c.club_type?.trim() ?? "";
    if (type) types.add(type);
  });
  return Array.from(types).sort();
}

export async function loadClubsData(school?: string): Promise<{ clubs: Club[]; categories: string[] }> {
  const clubs = await getAllClubs(school);
  const categories = await getClubCategories(clubs);
  return { clubs, categories };
}

// --- Backend-synced saved/followed clubs ---

export async function fetchSavedClubIdsFromBackend(): Promise<number[]> {
  return api.get<number[]>("/saved-clubs/");
}

export async function saveClubToBackend(clubId: number): Promise<void> {
  await api.put<void>(`/saved-clubs/${clubId}`);
}

export async function unsaveClubToBackend(clubId: number): Promise<void> {
  await api.delete(`/saved-clubs/${clubId}`);
}

