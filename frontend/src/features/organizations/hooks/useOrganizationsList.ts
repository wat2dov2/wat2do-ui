import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Organization } from "@/shared/types";
import { getOrganizationsPaginated } from "@/features/organizations/api/organizations.api";

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

function buildQueryKey(options: {
  page: number;
  limit: number;
  school?: string;
  search?: string;
  categories?: string[];
  organizationType?: string;
  ids?: number[];
  isAuthenticated?: boolean;
  activeTab?: "all" | "followed" | "claimed";
  isSavedLoaded?: boolean;
}): string {
  const {
    page,
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

  return JSON.stringify({
    page,
    limit,
    school: school || "",
    search: search || "",
    categories: (categories || []).join(","),
    organizationType: organizationType || "",
    ...((activeTab === "followed" || activeTab === "claimed")
      ? {
          ids: (ids || []).join(","),
          isAuthenticated: Boolean(isAuthenticated),
          isSavedLoaded: Boolean(isSavedLoaded),
        }
      : {}),
    activeTab,
  });
}

/**
 * useOrganizationsList Hook
 * Centralized hook to manage fetching paginated organizations with deduplication.
 */
export function useOrganizationsList(options: UseOrganizationsListOptions) {
  const {
    limit,
    mode = "paginated",
    school,
    search,
    categories,
    organizationType,
    ids,
    isAuthenticated,
    activeTab = "all",
    isSavedLoaded = true,
  } = options;

  const [currentPage, setCurrentPage] = useState(1);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const lastFetchedQueryKeyRef = useRef<string>("");
  const latestFetchIdRef = useRef(0);

  const categoriesStr = (categories || []).join(",");
  const idsStr = (ids || []).join(",");

  const filterKey = useMemo(
    () =>
      JSON.stringify({
        limit,
        school: school || "",
        search: search || "",
        categories: categoriesStr,
        organizationType: organizationType || "",
        ids: idsStr,
        isAuthenticated: Boolean(isAuthenticated),
        activeTab,
        isSavedLoaded: Boolean(isSavedLoaded),
      }),
    [
      limit,
      school,
      search,
      categoriesStr,
      organizationType,
      idsStr,
      isAuthenticated,
      activeTab,
      isSavedLoaded,
    ],
  );

  useEffect(() => {
    setCurrentPage(1);
    setOrganizations([]);
    setHasMore(false);
    lastFetchedQueryKeyRef.current = "";
  }, [filterKey]);

  const loadData = useCallback(async () => {
    const fetchId = ++latestFetchIdRef.current;
    const queryKey = buildQueryKey({
      page: currentPage,
      limit,
      school,
      search,
      categories,
      organizationType,
      ids,
      isAuthenticated,
      activeTab,
      isSavedLoaded,
    });

    if ((activeTab === "followed" || activeTab === "claimed") && !isAuthenticated) {
      setOrganizations([]);
      setTotalItems(0);
      setTotalPages(0);
      setHasMore(false);
      setIsLoading(false);
      setIsLoadingMore(false);
      lastFetchedQueryKeyRef.current = queryKey;
      return;
    }

    if (activeTab === "followed" && !isSavedLoaded) {
      setIsLoading(true);
      setIsLoadingMore(false);
      return;
    }

    if (
      (activeTab === "followed" || activeTab === "claimed") &&
      (!ids || ids.length === 0)
    ) {
      setOrganizations([]);
      setTotalItems(0);
      setTotalPages(0);
      setHasMore(false);
      setIsLoading(false);
      setIsLoadingMore(false);
      lastFetchedQueryKeyRef.current = queryKey;
      return;
    }

    if (lastFetchedQueryKeyRef.current === queryKey) {
      return;
    }
    lastFetchedQueryKeyRef.current = queryKey;

    const isLoadMore = mode === "infinite" && currentPage > 1;
    if (isLoadMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }

    try {
      const result = await getOrganizationsPaginated({
        page: currentPage,
        limit,
        school,
        search,
        categories,
        organizationType,
        ids: activeTab === "followed" || activeTab === "claimed" ? ids : undefined,
      });

      if (fetchId !== latestFetchIdRef.current) {
        return;
      }

      setTotalItems(result.total);
      setTotalPages(result.total_pages);
      setHasMore(result.page < result.total_pages);
      setOrganizations((current) =>
        mode === "infinite" && currentPage > 1
          ? getUniqueOrganizations([...current, ...result.items])
          : result.items,
      );
    } catch (error) {
      if (fetchId !== latestFetchIdRef.current) {
        return;
      }
      console.error("Failed to load organizations data:", error);
      if (mode === "infinite" && currentPage > 1) {
        setHasMore(false);
      }
    } finally {
      if (fetchId === latestFetchIdRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [
    activeTab,
    categories,
    currentPage,
    ids,
    isAuthenticated,
    isSavedLoaded,
    limit,
    mode,
    organizationType,
    school,
    search,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadMore = useCallback(() => {
    if (mode !== "infinite" || isLoading || isLoadingMore || !hasMore) {
      return;
    }
    setCurrentPage((page) => page + 1);
  }, [hasMore, isLoading, isLoadingMore, mode]);

  return {
    organizations,
    totalItems,
    totalPages,
    isLoading,
    isLoadingMore,
    hasMore,
    currentPage,
    setCurrentPage,
    loadMore,
    refresh: () => {
      lastFetchedQueryKeyRef.current = "";
      void loadData();
    },
  };
}
