/**
 * Search Feature - Public API
 * 
 * This is the internal contract for the search feature.
 * Other features should consume this API, not the implementation details.
 */

// Core search operations
export {
  filterEvents,
  sortEvents,
  getFilterCounts,
  type SearchFilters,
  type SortOptions,
} from "@/features/search/api/searchService";

// Filter state management
export {
  createFilterState,
  serializeFiltersToJSON,
  parseFiltersFromJSON,
  buildFilterQueryString,
  parseFilterQueryString,
  hasActiveFilters,
  clearFilters,
} from "@/features/search/api/filterService";
