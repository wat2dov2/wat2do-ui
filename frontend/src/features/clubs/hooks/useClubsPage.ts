import { useState, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useDiscoveryQueryTracking } from "@/shared/hooks/useDiscoveryQueryTracking";
import { useEventsStore } from "@/features/events/store/events.store";
import { useAppConstants } from "@/shared/hooks/useAppConstants";
import { resolveSchool } from "@/shared/constants/schools";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useClubsList } from "@/features/clubs/hooks/useClubsList";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";
import { controlBox } from "@/shared/config/controlBox";

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

  const schoolFilter = useEventsStore((s) => s.schoolFilter);
  const resolvedSchoolFilter = resolveSchool(schoolFilter ?? initialSchool);

  const { club_categories: allCategories } = useAppConstants();

  const isSavedLoaded = useSavedClubsStore((s) => s.hasLoaded);

  const {
    clubs,
    totalItems,
    currentPage,
    isLoading,
    isError,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh,
  } = useClubsList({
    mode: "infinite",
    limit: controlBox.clubManagement.directoryPageSize,
    school: resolvedSchoolFilter,
    search: submittedSearch.query,
    categories: selectedCategories,
    minEvents,
    ids: activeTab === "followed" ? savedClubIds : (activeTab === "claimed" ? claimedClubIds : undefined),
    isAuthenticated,
    activeTab,
    isSavedLoaded: activeTab === "followed" ? isSavedLoaded : true,
    initialDirectory,
    initialSchool,
  });

  useDiscoveryQueryTracking({
    school: resolvedSchoolFilter,
    surface: "clubs",
    search_query: submittedSearch.query,
    filters: { categories: selectedCategories, minEvents, tab: activeTab, page: currentPage },
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
    isLoading,
    isError,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh,
    toggleCategory,
    totalItems,
    activeTab,
    setActiveTab,
  };
}
