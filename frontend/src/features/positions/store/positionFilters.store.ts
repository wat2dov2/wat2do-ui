/** The positions directory's search and filters, kept while the reader visits a club (see directoryFilters.store). */

import type { PositionType } from "@/shared/types";
import { createDirectoryFiltersStore } from "@/shared/store/directoryFilters.store";

export interface PositionFilters {
  positionType: PositionType | "all";
  addedSince: string | null;
}

export const NO_POSITION_FILTERS: PositionFilters = { positionType: "all", addedSince: null };

export const usePositionFiltersStore = createDirectoryFiltersStore<PositionFilters>(NO_POSITION_FILTERS);
