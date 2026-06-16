import { useState, useEffect, useCallback, useRef } from "react";
import type { Organization } from "@/shared/types";
import { getOrganizationsPaginated } from "@/features/organizations/api/organizations.api";

interface UseOrganizationsListOptions {
  limit: number;
  school?: string;
  search?: string;
  categories?: string[];
  organizationType?: string;
  ids?: number[];
  isAuthenticated?: boolean;
  activeTab?: "all" | "followed" | "claimed";
  isSavedLoaded?: boolean;
}

/**
 * useOrganizationsList Hook
 * Centralized hook to manage fetching paginated organizations with deduplication.
 */
export function useOrganizationsList(options: UseOrganizationsListOptions) {
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

  const [currentPage, setCurrentPage] = useState(1);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const lastFetchedOptionsRef = useRef<string>("");

  const categoriesStr = (categories || []).join(",");
  const idsStr = (ids || []).join(",");

  // Keep latest options in a ref for absolute stability of loadData callback
  const latestOptionsRef = useRef({
    currentPage,
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

  useEffect(() => {
    latestOptionsRef.current = {
      currentPage,
      limit,
      school,
      search,
      categories,
      organizationType,
      ids,
      isAuthenticated,
      activeTab,
      isSavedLoaded,
    };
  });

  const loadData = useCallback(async () => {
    const {
      currentPage: latestPage,
      limit: latestLimit,
      school: latestSchool,
      search: latestSearch,
      categories: latestCategories,
      organizationType: latestOrgType,
      ids: latestIds,
      isAuthenticated: latestAuth,
      activeTab: latestTab,
      isSavedLoaded: latestSavedLoaded,
    } = latestOptionsRef.current;

    // Generate serialized options for deduplication
    const queryParams = {
      page: latestPage,
      limit: latestLimit,
      school: latestSchool || "",
      search: latestSearch || "",
      categories: (latestCategories || []).join(","),
      organizationType: latestOrgType || "",
      ...((latestTab === "followed" || latestTab === "claimed") ? {
        ids: (latestIds || []).join(","),
        isAuthenticated: Boolean(latestAuth),
        isSavedLoaded: Boolean(latestSavedLoaded),
      } : {}),
      activeTab: latestTab,
    };

    const queryKey = JSON.stringify(queryParams);

    // If followed or claimed tab but user not authenticated, don't query
    if ((latestTab === "followed" || latestTab === "claimed") && !latestAuth) {
      setOrganizations([]);
      setTotalItems(0);
      setTotalPages(0);
      setIsLoading(false);
      lastFetchedOptionsRef.current = queryKey;
      return;
    }

    // If followed tab and saved store hasn't loaded yet, show loading and don't query
    if (latestTab === "followed" && !latestSavedLoaded) {
      setIsLoading(true);
      return;
    }

    // If followed or claimed tab and we have no ids to query, return empty list
    if ((latestTab === "followed" || latestTab === "claimed") && (!latestIds || latestIds.length === 0)) {
      setOrganizations([]);
      setTotalItems(0);
      setTotalPages(0);
      setIsLoading(false);
      lastFetchedOptionsRef.current = queryKey;
      return;
    }

    if (lastFetchedOptionsRef.current === queryKey) {
      return; // Skip duplicate fetch
    }
    lastFetchedOptionsRef.current = queryKey;

    setIsLoading(true);
    try {
      const result = await getOrganizationsPaginated({
        page: latestPage,
        limit: latestLimit,
        school: latestSchool,
        search: latestSearch,
        categories: latestCategories,
        organizationType: latestOrgType,
        ids: (latestTab === "followed" || latestTab === "claimed") ? latestIds : undefined,
      });
      setOrganizations(result.items);
      setTotalItems(result.total);
      setTotalPages(result.total_pages);
    } catch (error) {
      console.error("Failed to load organizations data:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [
    currentPage,
    limit,
    school,
    search,
    categoriesStr,
    organizationType,
    idsStr,
    isAuthenticated,
    activeTab,
    isSavedLoaded,
    loadData,
  ]);

  return {
    organizations,
    totalItems,
    totalPages,
    isLoading,
    currentPage,
    setCurrentPage,
    refresh: loadData,
  };
}
