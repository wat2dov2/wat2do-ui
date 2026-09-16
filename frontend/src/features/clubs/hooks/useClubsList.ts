import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Club } from "@/shared/types";
import { getClubsPaginated } from "@/features/clubs/api/clubs.api";
import type { PaginatedClubsResponse } from "@/features/clubs/api/clubs.api";
import { queryKeys } from "@/shared/lib/queryKeys";
import { stableClubsFilters, type ClubsListFilters } from "@/features/clubs/lib/clubsQuery";

type ClubsListMode = "paginated" | "infinite";

interface UseClubsListOptions extends ClubsListFilters {
  mode?: ClubsListMode;
  initialDirectory?: PaginatedClubsResponse | null;
  initialSchool?: string;
}

function getUniqueClubs(clubs: Club[]): Club[] {
  const seen = new Set<number>();
  return clubs.filter((club) => {
    if (seen.has(club.id)) {
      return false;
    }
    seen.add(club.id);
    return true;
  });
}

function useClubsListFilters(options: UseClubsListOptions) {
  const {
    limit,
    school,
    search,
    categories,
    clubType,
    minEvents,
    ids,
    isAuthenticated,
    activeTab = "all",
    isSavedLoaded = true,
  } = options;

  return useMemo(
    () => ({
      limit,
      school,
      search,
      categories,
      clubType,
      minEvents,
      ids,
      isAuthenticated,
      activeTab,
      isSavedLoaded,
    }),
    [
      limit,
      school,
      search,
      categories,
      clubType,
      minEvents,
      ids,
      isAuthenticated,
      activeTab,
      isSavedLoaded,
    ],
  );
}

function isClubsListEnabled(
  filters: ReturnType<typeof useClubsListFilters>,
): boolean {
  const { activeTab, isAuthenticated, isSavedLoaded, ids } = filters;

  if ((activeTab === "followed" || activeTab === "claimed") && !isAuthenticated) {
    return false;
  }

  if (activeTab === "followed" && !isSavedLoaded) {
    return false;
  }

  if ((activeTab === "followed" || activeTab === "claimed") && (!ids || ids.length === 0)) {
    return false;
  }

  return true;
}

export function useClubsList(options: UseClubsListOptions) {
  const { mode = "paginated", limit } = options;
  const queryClient = useQueryClient();
  const filters = useClubsListFilters(options);
  const enabled = isClubsListEnabled(filters);
  const stableFilters = useMemo(() => stableClubsFilters(filters), [filters]);
  const listQueryKey = useMemo(
    () => queryKeys.clubs.list(stableFilters),
    [stableFilters],
  );
  const listQueryKeyString = JSON.stringify(listQueryKey);
  const [pageState, setPageState] = useState({ key: "", page: 1 });
  const currentPage = pageState.key === listQueryKeyString ? pageState.page : 1;
  const canUseInitialDirectory =
    mode === "infinite" &&
    filters.activeTab === "all" &&
    filters.school === options.initialSchool &&
    !filters.search &&
    !filters.clubType &&
    !filters.minEvents &&
    (!filters.categories || filters.categories.length === 0) &&
    (!filters.ids || filters.ids.length === 0) &&
    options.initialDirectory != null;
  const setCurrentPage = useCallback((page: number) => {
    setPageState({ key: listQueryKeyString, page });
  }, [listQueryKeyString]);

  const loadPage = (page: number) =>
    getClubsPaginated({
      page,
      limit,
      school: filters.school,
      search: filters.search,
      categories: filters.categories,
      clubType: filters.clubType,
      minEvents: filters.minEvents,
      ids:
        filters.activeTab === "followed" || filters.activeTab === "claimed"
          ? filters.ids
          : undefined,
    });

  const infiniteQuery = useInfiniteQuery({
    queryKey: listQueryKey,
    queryFn: ({ pageParam }) => loadPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    enabled: enabled && mode === "infinite",
    retry: false,
    initialData: canUseInitialDirectory
      ? {
          pages: [options.initialDirectory],
          pageParams: [1],
        }
      : undefined,
  });

  const pageQuery = useQuery({
    queryKey: [...listQueryKey, "page", currentPage],
    queryFn: () => loadPage(currentPage),
    enabled: enabled && mode === "paginated",
    retry: false,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: listQueryKey });
  }, [listQueryKey, queryClient]);

  if (!enabled) {
    return {
      clubs: [] as Club[],
      totalItems: 0,
      totalPages: 0,
      isLoading: filters.activeTab === "followed" && !filters.isSavedLoaded,
      isError: false,
      isLoadingMore: false,
      hasMore: false,
      currentPage: 1,
      setCurrentPage,
      loadMore: () => undefined,
      refresh,
    };
  }

  if (mode === "infinite") {
    const pages = infiniteQuery.data?.pages ?? [];
    const lastPage = pages[pages.length - 1];

    return {
      clubs: getUniqueClubs(pages.flatMap((page) => page.items)),
      totalItems: lastPage?.total ?? 0,
      totalPages: lastPage?.total_pages ?? 0,
      isLoading: infiniteQuery.isLoading,
      isError: infiniteQuery.isError,
      isLoadingMore: infiniteQuery.isFetchingNextPage,
      hasMore: !infiniteQuery.isError && (infiniteQuery.hasNextPage ?? false),
      currentPage: lastPage?.page ?? 1,
      setCurrentPage,
      loadMore: () => {
        if (!infiniteQuery.hasNextPage || infiniteQuery.isFetchingNextPage || infiniteQuery.isError) return;
        void infiniteQuery.fetchNextPage();
      },
      refresh,
    };
  }

  const pageData = pageQuery.data;

  return {
    clubs: pageData?.items ?? [],
    totalItems: pageData?.total ?? 0,
    totalPages: pageData?.total_pages ?? 0,
    isLoading: pageQuery.isLoading,
    isError: pageQuery.isError,
    isLoadingMore: false,
    hasMore: false,
    currentPage,
    setCurrentPage,
    loadMore: () => undefined,
    refresh,
  };
}
