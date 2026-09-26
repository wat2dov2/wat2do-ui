import { useState, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDiscoveryQueryTracking } from "@/shared/hooks/useDiscoveryQueryTracking";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { resolveSchool } from "@/shared/constants/schools";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useQuery } from "@tanstack/react-query";
import { getAllClubs } from "@/features/clubs/api/clubs.api";
import { filterClubs } from "@/features/clubs/api/clubService";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";

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
  const [activeTab, setActiveTab] = useState<"all" | "followed" | "claimed">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState({ query: "", revision: 0 });
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [minEvents, setMinEvents] = useState(0);

  const resolvedSchoolFilter = resolveSchool(initialSchool);

  const { club_categories: allCategories } = useAppConstants();

  const isSavedLoaded = useSavedClubsStore((s) => s.hasLoaded);

  const query = useQuery({
    queryKey: queryKeys.clubs.allForSchool(resolvedSchoolFilter),
    queryFn: () => getAllClubs(resolvedSchoolFilter),
    retry: false,
    initialData: initialDirectory?.items,
  });
  const clubs = useMemo(() => filterClubs(query.data ?? [], {
    search: submittedSearch.query,
    categories: selectedCategories,
    minEvents,
    ids: activeTab === "all" ? undefined : !isAuthenticated ? []
      : activeTab === "followed" ? savedClubIds : claimedClubIds,
  }), [query.data, submittedSearch.query, selectedCategories, minEvents, activeTab, isAuthenticated, savedClubIds, claimedClubIds]);

  useDiscoveryQueryTracking({
    school: resolvedSchoolFilter,
    surface: "clubs",
    search_query: submittedSearch.query,
    filters: { categories: selectedCategories, minEvents, tab: activeTab },
  }, submittedSearch.revision);

  const submitSearchQuery = useCallback(() => {
    setSubmittedSearch(previous => ({ query: searchQuery.trim(), revision: previous.revision + 1 }));
  }, [searchQuery]);

  const clearSearchQuery = useCallback(() => {
    setSearchQuery("");
    setSubmittedSearch(previous => ({ query: "", revision: previous.revision + 1 }));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  }, []);

  return {
    minEvents,
    setMinEvents: (value: number) => setMinEvents(Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0),
    searchQuery,
    setSearchQuery,
    submitSearchQuery,
    clearSearchQuery,
    selectedCategories,
    clubs,
    allCategories,
    isLoading: query.isLoading || (isAuthenticated && activeTab === "followed" && !isSavedLoaded),
    isError: query.isLoadingError,
    refresh: () => void query.refetch(),
    toggleCategory,
    totalItems: clubs.length,
    activeTab,
    setActiveTab,
  };
}
