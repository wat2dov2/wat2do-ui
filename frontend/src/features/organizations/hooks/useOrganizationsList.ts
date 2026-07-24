import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Organization } from "@/shared/types";
import { getOrganizationsPaginated } from "@/features/organizations/api/organizations.api";
import { queryKeys } from "@/shared/lib/queryKeys";
import { stableOrganizationsFilters } from "@/features/organizations/lib/organizationsQuery";

type OrganizationsListMode = "paginated" | "infinite";

interface UseOrganizationsListOptions {
  limit: number;
  mode?: OrganizationsListMode;
  school?: string;
  search?: string;
  categories?: string[];
  organizationType?: string;
  ids?: number[];
  isAuthenticated?: boolean;
  activeTab?: "all" | "followed" | "claimed";
  isSavedLoaded?: boolean;
}

function getUniqueOrganizations(organizations: Organization[]): Organization[] {
  const seen = new Set<number>();
  return organizations.filter((organization) => {
    if (seen.has(organization.id)) {
      return false;
    }
    seen.add(organization.id);
    return true;
  });
}

function useOrganizationsListFilters(options: UseOrganizationsListOptions) {
  const {
    limit,
    school,
    search,
    categories,
    organizationType,
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
      organizationType,
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
      organizationType,
      ids,
      isAuthenticated,
      activeTab,
      isSavedLoaded,
    ],
  );
}

function isOrganizationsListEnabled(
  filters: ReturnType<typeof useOrganizationsListFilters>,
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

/**
 * useOrganizationsList Hook
 * Centralized hook to manage fetching paginated organizations with TanStack Query caching.
 */
export function useOrganizationsList(options: UseOrganizationsListOptions) {
  const { mode = "paginated", limit } = options;
  const queryClient = useQueryClient();
  const filters = useOrganizationsListFilters(options);
  const enabled = isOrganizationsListEnabled(filters);
  const stableFilters = useMemo(() => stableOrganizationsFilters(filters), [filters]);
  const listQueryKey = useMemo(
    () => queryKeys.organizations.list(stableFilters),
    [stableFilters],
  );
  const listQueryKeyString = JSON.stringify(listQueryKey);
  const [pageState, setPageState] = useState({ key: "", page: 1 });
  const currentPage = pageState.key === listQueryKeyString ? pageState.page : 1;
  const setCurrentPage = useCallback((page: number) => {
    setPageState({ key: listQueryKeyString, page });
  }, [listQueryKeyString]);

  const infiniteQuery = useInfiniteQuery({
    queryKey: listQueryKey,
    queryFn: ({ pageParam }) =>
      getOrganizationsPaginated({
        page: pageParam,
        limit,
        school: filters.school,
        search: filters.search,
        categories: filters.categories,
        organizationType: filters.organizationType,
        ids:
          filters.activeTab === "followed" || filters.activeTab === "claimed"
            ? filters.ids
            : undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    enabled: enabled && mode === "infinite",
  });

  const pageQuery = useQuery({
    queryKey: [...listQueryKey, "page", currentPage],
    queryFn: () =>
      getOrganizationsPaginated({
        page: currentPage,
        limit,
        school: filters.school,
        search: filters.search,
        categories: filters.categories,
        organizationType: filters.organizationType,
        ids:
          filters.activeTab === "followed" || filters.activeTab === "claimed"
            ? filters.ids
            : undefined,
      }),
    enabled: enabled && mode === "paginated",
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: listQueryKey });
  }, [listQueryKey, queryClient]);

  if (!enabled) {
    return {
      organizations: [] as Organization[],
      totalItems: 0,
      totalPages: 0,
      isLoading: filters.activeTab === "followed" && !filters.isSavedLoaded,
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
      organizations: getUniqueOrganizations(pages.flatMap((page) => page.items)),
      totalItems: lastPage?.total ?? 0,
      totalPages: lastPage?.total_pages ?? 0,
      isLoading: infiniteQuery.isLoading,
      isLoadingMore: infiniteQuery.isFetchingNextPage,
      hasMore: infiniteQuery.hasNextPage ?? false,
      currentPage: lastPage?.page ?? 1,
      setCurrentPage,
      loadMore: () => {
        if (!infiniteQuery.hasNextPage || infiniteQuery.isFetchingNextPage) return;
        void infiniteQuery.fetchNextPage();
      },
      refresh,
    };
  }

  const pageData = pageQuery.data;

  return {
    organizations: pageData?.items ?? [],
    totalItems: pageData?.total ?? 0,
    totalPages: pageData?.total_pages ?? 0,
    isLoading: pageQuery.isLoading,
    isLoadingMore: false,
    hasMore: false,
    currentPage,
    setCurrentPage,
    loadMore: () => undefined,
    refresh,
  };
}
