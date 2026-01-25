import React from "react";

/**
 * Filter-related types
 */

export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  priceRange: { min: string; max: string };
  dateRange: string;
  addedSince: string;
  requiresRegistration: boolean;
}

export type FilterViewMode = "visual" | "json";

export interface QuickFilterConfig {
  id: string;
  icon: React.ReactNode;
  labelKey: string; // i18n key
  active: boolean;
  onClick: () => void;
  badge?: number;
  visible?: boolean; // for conditional rendering (e.g., profileCompleted)
}
