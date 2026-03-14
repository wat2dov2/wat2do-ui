/**
 * Clubs API
 * All clubs come from the backend. No mock/static data.
 */

import type { Club } from "@/shared/types";
import { api } from "@/shared/services/apiClient";
import {
  loadUserClubs,
  saveUserClubs,
  loadUserClubIds,
  saveUserClubIds,
  removeUserClub,
} from "@/features/clubs/api/clubRepository";
import {
  createClub,
  updateClub as updateClubService,
  filterClubsBySearch,
  filterClubsByCategory,
  filterClubsByType,
} from "@/features/clubs/api/clubService";

export async function getAllClubs(): Promise<Club[]> {
  const clubs = await api.get<Club[]>("/clubs/");
  return clubs;
}

export async function createClubAPI(clubData: Omit<Club, "id">): Promise<Club> {
  try {
    return await api.post<Club>("/clubs/", clubData);
  } catch {
    const newClub = createClub(clubData);
    const userClubs = loadUserClubs();
    const userClubIds = loadUserClubIds();
    saveUserClubs([...userClubs, newClub]);
    saveUserClubIds([...userClubIds, newClub.id]);
    return newClub;
  }
}

export async function updateClubAPI(
  club: Club,
  clubData: Partial<Omit<Club, "id">>,
): Promise<Club> {
  try {
    return await api.patch<Club>(`/clubs/${club.id}`, clubData);
  } catch {
    const updatedClub = updateClubService(club, clubData);
    const userClubs = loadUserClubs();
    const idx = userClubs.findIndex((c) => c.id === club.id);
    if (idx !== -1) {
      userClubs[idx] = updatedClub;
      saveUserClubs(userClubs);
    } else {
      const userClubIds = loadUserClubIds();
      saveUserClubs([...userClubs, updatedClub]);
      saveUserClubIds([...userClubIds, updatedClub.id]);
    }
    return updatedClub;
  }
}

export async function deleteClubAPI(clubId: number): Promise<void> {
  try {
    await api.delete(`/clubs/${clubId}`);
  } catch {
    // still clean up local
  }
  removeUserClub(clubId);
}

export async function filterClubs(
  clubs: Club[],
  options: { categories?: string[]; clubType?: string; searchQuery?: string },
): Promise<Club[]> {
  let filtered = clubs;
  if (options.searchQuery) filtered = filterClubsBySearch(filtered, options.searchQuery);
  if (options.categories?.length) filtered = filterClubsByCategory(filtered, options.categories);
  if (options.clubType) filtered = filterClubsByType(filtered, options.clubType);
  return filtered;
}

export async function getClubCategories(): Promise<string[]> {
  const clubs = await getAllClubs();
  const cats = new Set<string>();
  clubs.forEach((c) => c.categories.forEach((cat) => cats.add(cat)));
  return Array.from(cats).sort();
}

export async function getClubTypes(): Promise<string[]> {
  const clubs = await getAllClubs();
  const types = new Set<string>();
  clubs.forEach((c) => types.add(c.club_type));
  return Array.from(types).sort();
}

export async function loadClubsData(): Promise<{ clubs: Club[]; categories: string[] }> {
  const [clubs, categories] = await Promise.all([getAllClubs(), getClubCategories()]);
  return { clubs, categories };
}
