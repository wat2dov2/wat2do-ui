/**
 * Clubs API
 * All clubs come from the backend. No mock/static data.
 */

import type { Club } from "@/shared/types";
import { api } from "@/shared/services/apiClient";
import {
  filterClubsBySearch,
  filterClubsByCategory,
  filterClubsByType,
} from "@/features/clubs/api/clubService";

const CLUBS_LIST_LIMIT = 500;

export async function getAllClubs(): Promise<Club[]> {
  const clubs = await api.get<Club[]>(`/clubs/?limit=${CLUBS_LIST_LIMIT}`);
  return clubs;
}

export async function getMyClubs(): Promise<Club[]> {
  return api.get<Club[]>("/clubs/mine");
}

export async function createClubAPI(clubData: Omit<Club, "id">): Promise<Club> {
  const { created_by, ...payload } = clubData;
  return api.post<Club>("/clubs/", {
    ...payload,
    owner_user_id: created_by || undefined,
  });
}

export async function updateClubAPI(
  club: Club,
  clubData: Partial<Omit<Club, "id">>,
): Promise<Club> {
  const payload = { ...clubData };
  delete payload.created_by;
  return api.patch<Club>(`/clubs/${club.id}`, payload);
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
  clubs.forEach((c) => types.add(c.club_type));
  return Array.from(types).sort();
}

export async function loadClubsData(): Promise<{ clubs: Club[]; categories: string[] }> {
  const clubs = await getAllClubs();
  const categories = await getClubCategories(clubs);
  return { clubs, categories };
}
