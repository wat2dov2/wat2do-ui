export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  maxPrice: string;
  registration: boolean;
  organizations: string[];
  freeFood: boolean;
  going: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedSince: string;
}
