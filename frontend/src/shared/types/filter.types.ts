export type EventDateFilter =
  | "any"
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "thisWeekend"
  | "nextWeek"
  | "custom";

export interface FilterState {
  searchQuery: string;
  categories: string[];
  locations: string[];
  foods: string[];
  days: string[];
  minPrice: string;
  maxPrice: string;
  minGoing: number;
  registration: boolean;
  clubs: string[];
  hasFood: boolean;
  going: boolean;
  sortBy: string;
  sortOrder: "asc" | "desc";
  addedSince: string;
  dateFilter: EventDateFilter;
  customDate: string;
}
