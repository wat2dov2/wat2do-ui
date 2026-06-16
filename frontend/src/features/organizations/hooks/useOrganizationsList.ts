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
  activeTab?: "all" | "followed";
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
  } = options;

  const [currentPage, setCurrentPage] = useState(1);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const lastFetchedOptionsRef = useRef<string>("");

  const loadData = useCallback(async () => {
    // Generate serialized options for deduplication
    const queryParams = {
      page: currentPage,
      limit,
      school: school || "",
      search: search || "",
      categories: (categories || []).join(","),
      organizationType: organizationType || "",
      ...(activeTab === "followed" ? {
        ids: (ids || []).join(","),
        isAuthenticated: Boolean(isAuthenticated),
      } : {}),
      activeTab,
    };

    // If followed tab but user not authenticated, don't query
    if (activeTab === "followed" && !isAuthenticated) {
      setOrganizations([]);
      setTotalItems(0);
      setTotalPages(0);
      setIsLoading(false);
      return;
    }

    const queryKey = JSON.stringify(queryParams);
    if (lastFetchedOptionsRef.current === queryKey) {
      return; // Skip duplicate fetch
    }
    lastFetchedOptionsRef.current = queryKey;

    setIsLoading(true);
    try {
      const result = await getOrganizationsPaginated({
        page: currentPage,
        limit,
        school,
        search,
        categories,
        organizationType,
        ids: activeTab === "followed" ? ids : undefined,
      });
      setOrganizations(result.items);
      setTotalItems(result.total);
      setTotalPages(result.total_pages);
    } catch (error) {
      console.error("Failed to load organizations data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [
    currentPage,
    limit,
    school,
    search,
    categories,
    organizationType,
    ids,
    isAuthenticated,
    activeTab,
  ]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
