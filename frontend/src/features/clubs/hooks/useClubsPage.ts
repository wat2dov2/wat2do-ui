import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDiscoveryQueryTracking } from "@/shared/hooks/useDiscoveryQueryTracking";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { resolveSchool } from "@/shared/constants/schools";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { useClubFiltersStore, type ClubScope } from "@/features/clubs/store/clubFilters.store";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useQuery } from "@tanstack/react-query";
import { clubDirectoryQueryOptions } from "@/features/clubs/api/clubs.api";
import { filterClubs } from "@/features/clubs/api/clubService";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";
import { discoverySnapshotSeed } from "@/shared/api/discovery.api";

interface UseClubsPageOptions {
  initialDirectory: PaginatedClubsResponse | null;
  initialSchool: string;
}

export function useClubsPage({
  initialDirectory,
  initialSchool,
}: UseClubsPageOptions) {
  const { isAuthenticated, clubs: claimedClubs } = useAuthState();
  const claimedClubIds = useMemo(() => claimedClubs.map((c) => c.id), [claimedClubs]);
  const savedClubIds = useSavedClubsStore(useShallow((s) => s.savedClubIds));
  // The search and filters outlive the page, so a club's "All clubs" link or Back finds them as they were.
  const { searchQuery, submittedSearch, filters, setSearchQuery, submitSearch, clearSearch, setFilters } =
    useClubFiltersStore(useShallow((s) => s));
  const { activeTab, selectedCategories, minEvents, addedSince } = filters;

  const resolvedSchoolFilter = resolveSchool(initialSchool);

  const { club_categories: allCategories } = useAppConstants();

  const isSavedLoaded = useSavedClubsStore((s) => s.hasLoaded);

  const query = useQuery({
    ...clubDirectoryQueryOptions(resolvedSchoolFilter),
    ...discoverySnapshotSeed(initialDirectory),
  });
  const clubs = useMemo(() => filterClubs(query.data?.items ?? [], {
    search: submittedSearch.query,
    categories: selectedCategories,
    minEvents,
    addedSince,
    ids: activeTab === "all" ? undefined : !isAuthenticated ? []
      : activeTab === "followed" ? savedClubIds : claimedClubIds,
  }), [query.data, submittedSearch.query, selectedCategories, minEvents, addedSince, activeTab, isAuthenticated, savedClubIds, claimedClubIds]);

  useDiscoveryQueryTracking({
    school: resolvedSchoolFilter,
    surface: "clubs",
    search_query: submittedSearch.query,
    filters: { categories: selectedCategories, minEvents, addedSince, tab: activeTab },
  }, submittedSearch.revision);

  const toggleCategory = useCallback((category: string) => {
    setFilters(({ selectedCategories: current }) => ({
      selectedCategories: current.includes(category)
        ? current.filter((c) => c !== category)
        : [...current, category],
    }));
  }, [setFilters]);

  return {
    appliedQueryKey: JSON.stringify({ submittedSearch, filters }),
    addedSince,
    setAddedSince: (value: string | null) => setFilters({ addedSince: value }),
    clearNew: () => setFilters({ addedSince: null }),
    minEvents,
    setMinEvents: (value: number) => setFilters({ minEvents: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0 }),
    searchQuery,
    setSearchQuery,
    submitSearch,
    clearSearch,
    selectedCategories,
    clubs,
    allCategories,
    isLoading: query.isLoading || (isAuthenticated && activeTab === "followed" && !isSavedLoaded),
    isError: query.isLoadingError,
    refresh: () => void query.refetch(),
    toggleCategory,
    totalItems: clubs.length,
    activeTab,
    setActiveTab: (value: ClubScope) => setFilters({ activeTab: value }),
  };
}
