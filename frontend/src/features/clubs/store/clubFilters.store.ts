/** The clubs directory's search and filters, kept while the reader visits a club (see directoryFilters.store). */

import { createDirectoryFiltersStore } from "@/shared/store/directoryFilters.store";

/** Which clubs the directory lists: every club, the ones the reader follows, or the ones they manage. */
export type ClubScope = "all" | "followed" | "claimed";

export interface ClubFilters {
  activeTab: ClubScope;
  selectedCategories: string[];
  minEvents: number;
  addedSince: string | null;
}

export const useClubFiltersStore = createDirectoryFiltersStore<ClubFilters>({
  activeTab: "all",
  selectedCategories: [],
  minEvents: 0,
  addedSince: null,
});
