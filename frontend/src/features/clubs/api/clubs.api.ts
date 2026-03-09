/**
 * Clubs API
 * Handles all club-related data operations
 * 
 * This is the public API for the clubs feature.
 * It consolidates repository and service operations.
 * 
 * All functions are async to prepare for future backend integration.
 */

import type { Club } from "@/shared/types";
import { mockClubs } from "@/features/clubs/data/clubs";
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

/**
 * Get all clubs (mock + user-created)
 * Deduplicates to prevent duplicate clubs from localStorage
 */
export async function getAllClubs(): Promise<Club[]> {
  const userClubs = loadUserClubs();
  const userClubIds = loadUserClubIds();
  
  // Filter out mock clubs that have been replaced by user-created versions
  const filteredMockClubs = mockClubs.filter(
    (club) => !userClubIds.includes(club.id)
  );
  
  return [...filteredMockClubs, ...userClubs];
}

/**
 * Create a new club
 */
export async function createClubAPI(clubData: Omit<Club, "id">): Promise<Club> {
  const newClub = createClub(clubData);
  const userClubs = loadUserClubs();
  const userClubIds = loadUserClubIds();
  
  saveUserClubs([...userClubs, newClub]);
  saveUserClubIds([...userClubIds, newClub.id]);
  
  return newClub;
}

/**
 * Update an existing club
 */
export async function updateClubAPI(
  club: Club,
  clubData: Partial<Omit<Club, "id">>
): Promise<Club> {
  const updatedClub = updateClubService(club, clubData);
  const userClubs = loadUserClubs();
  
  // Check if this is a user-created club
  const clubIndex = userClubs.findIndex((c) => c.id === club.id);
  
  if (clubIndex !== -1) {
    // Update user-created club
    userClubs[clubIndex] = updatedClub;
    saveUserClubs(userClubs);
  } else {
    // Convert mock club to user-created club
    const userClubIds = loadUserClubIds();
    saveUserClubs([...userClubs, updatedClub]);
    saveUserClubIds([...userClubIds, updatedClub.id]);
  }
  
  return updatedClub;
}

/**
 * Delete a club
 */
export async function deleteClubAPI(clubId: number): Promise<void> {
  removeUserClub(clubId);
}

/**
 * Filter clubs by categories
 */
export async function filterClubs(
  clubs: Club[],
  options: {
    categories?: string[];
    clubType?: string;
    searchQuery?: string;
  }
): Promise<Club[]> {
  let filtered = clubs;
  
  if (options.searchQuery) {
    filtered = filterClubsBySearch(filtered, options.searchQuery);
  }
  
  if (options.categories && options.categories.length > 0) {
    filtered = filterClubsByCategory(filtered, options.categories);
  }
  
  if (options.clubType) {
    filtered = filterClubsByType(filtered, options.clubType);
  }
  
  return filtered;
}

/**
 * Get unique categories from all clubs
 */
export async function getClubCategories(): Promise<string[]> {
  const clubs = await getAllClubs();
  const categories = new Set<string>();
  clubs.forEach((club) => {
    club.categories.forEach((cat) => categories.add(cat));
  });
  return Array.from(categories).sort();
}

/**
 * Get unique club types from all clubs
 */
export async function getClubTypes(): Promise<string[]> {
  const clubs = await getAllClubs();
  const types = new Set<string>();
  clubs.forEach((club) => types.add(club.club_type));
  return Array.from(types).sort();
}

/**
 * Load all clubs data (clubs + categories)
 * Useful for pages that need both
 */
export async function loadClubsData(): Promise<{
  clubs: Club[];
  categories: string[];
}> {
  const [clubs, categories] = await Promise.all([
    getAllClubs(),
    getClubCategories(),
  ]);
  return { clubs, categories };
}
