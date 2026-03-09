/**
 * Checklist API
 * Handles onboarding checklist data persistence
 * 
 * This is the public API for the checklist feature within auth.
 */

import { StorageService } from "@/shared/services/storageService";

const STORAGE_KEY = "wat2do_onboarding_checklist";

export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

export interface ChecklistData {
  items: ChecklistItem[];
}

/**
 * Load checklist data from localStorage
 */
export function loadChecklist(): ChecklistData | null {
  const saved = StorageService.getItem<string | null>(STORAGE_KEY, null);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as ChecklistData;
  } catch {
    return null;
  }
}

/**
 * Save checklist data to localStorage
 */
export function saveChecklist(data: ChecklistData): void {
  StorageService.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * Remove checklist data from localStorage
 */
export function removeChecklist(): void {
  StorageService.removeItem(STORAGE_KEY);
}

/**
 * Check if checklist exists in localStorage
 */
export function hasChecklist(): boolean {
  return StorageService.hasItem(STORAGE_KEY);
}
