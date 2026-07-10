import type { ReactNode } from "react";

export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  priceRange: { min: string; max: string };
  registration: boolean;
  organizations: string[];
  freeFood: boolean;
  going: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedWithin24h: boolean;
}

export type FilterViewMode = "visual" | "json";

export interface QuickFilterConfig {
  id: string;
  icon: ReactNode;
  labelKey: string; // i18n key
  active: boolean;
  onClick: () => void;
  visible?: boolean; // for conditional rendering (e.g., profileCompleted)
}
