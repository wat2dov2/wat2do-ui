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
  addedSince: string;
}

export type FilterViewMode = "visual" | "json";
