/**
 * Club Repository
 * Handles club data persistence
 */

import type { Club } from "@/shared/types";
import { StorageService } from "@/shared/services/storageService";

const STORAGE_KEYS = {
  USER_CREATED_CLUBS: "userCreatedClubs",
  USER_CREATED_CLUB_IDS: "userCreatedClubIds",
} as const;

/**
 * Load user-created clubs from localStorage
 */
export function loadUserClubs(): Club[] {
  return StorageService.getItem<Club[]>(STORAGE_KEYS.USER_CREATED_CLUBS, []);
}

/**
 * Save user-created clubs to localStorage
 */
export function saveUserClubs(clubs: Club[]): void {
  StorageService.setItem(STORAGE_KEYS.USER_CREATED_CLUBS, clubs);
}

/**
 * Load user-created club IDs from localStorage
 */
export function loadUserClubIds(): number[] {
  return StorageService.getItem<number[]>(
    STORAGE_KEYS.USER_CREATED_CLUB_IDS,
    []
  );
}

/**
 * Save user-created club IDs to localStorage
 */
export function saveUserClubIds(ids: number[]): void {
  StorageService.setItem(STORAGE_KEYS.USER_CREATED_CLUB_IDS, ids);
}

/**
 * Save both clubs and IDs together
 */
export function saveUserClubsAndIds(clubs: Club[], ids: number[]): void {
  saveUserClubs(clubs);
  saveUserClubIds(ids);
}

/**
 * Remove a user-created club
 */
export function removeUserClub(clubId: number): void {
  const clubs = loadUserClubs();
  const ids = loadUserClubIds();

  const filteredClubs = clubs.filter((c) => c.id !== clubId);
  const filteredIds = ids.filter((id) => id !== clubId);

  saveUserClubsAndIds(filteredClubs, filteredIds);
}
