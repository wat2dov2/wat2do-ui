import type { ReactNode } from "react";

/**
 * Filter-related types
 */

export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  datePreset: DatePreset;
  priceRange: { min: string; max: string };
  registration: boolean;
  organizations: string[];
  freeFood: boolean;
  saved: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
}

export type DatePreset = "upcoming" | "today" | "tomorrow" | "weekend";
export type FilterViewMode = "visual" | "json";

export interface QuickFilterConfig {
  id: string;
  icon: ReactNode;
  labelKey: string; // i18n key
  active: boolean;
  onMouseDown: () => void;
  badge?: number;
  visible?: boolean; // for conditional rendering (e.g., profileCompleted)
}
