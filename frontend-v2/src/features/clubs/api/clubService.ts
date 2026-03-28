/**
 * Club Service
 * Handles club CRUD operations
 */

import type { Club } from "@/shared/types";

/**
 * Create a new club
 */
export function createClub(clubData: Omit<Club, "id">): Club {
  const newId = Date.now();
  return {
    id: newId,
    ...clubData,
  };
}

/**
 * Update an existing club
 */
export function updateClub(club: Club, clubData: Partial<Omit<Club, "id">>): Club {
  return {
    ...club,
    ...clubData,
  };
}

/**
 * Filter clubs by search query
 */
export function filterClubsBySearch(clubs: Club[], searchQuery: string): Club[] {
  if (!searchQuery.trim()) {
    return clubs;
  }
  const query = searchQuery.toLowerCase();
  return clubs.filter((club) =>
    club.club_name.toLowerCase().includes(query)
  );
}

/**
 * Filter clubs by category
 */
export function filterClubsByCategory(
  clubs: Club[],
  categories: string[]
): Club[] {
  if (categories.length === 0) {
    return clubs;
  }
  return clubs.filter((club) =>
    club.categories.some((cat) => categories.includes(cat))
  );
}

/**
 * Filter clubs by club type
 */
export function filterClubsByType(clubs: Club[], clubType: string): Club[] {
  if (!clubType) {
    return clubs;
  }
  return clubs.filter((club) => club.club_type === clubType);
}
