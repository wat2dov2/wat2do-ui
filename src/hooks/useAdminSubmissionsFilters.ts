import { useState, useMemo } from "react";
import { getEventSubmissions } from "@/data/adminData";
import type { EventSubmission } from "@/types";

interface UseAdminSubmissionsFiltersOptions {
  refreshKey: number;
}

/**
 * Hook for managing filters in AdminSubmissionsPage
 */
export function useAdminSubmissionsFilters({ refreshKey }: UseAdminSubmissionsFiltersOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  // Get all submissions
  const allSubmissions = useMemo(() => {
    return getEventSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Filter submissions
  const filteredSubmissions = useMemo(() => {
    let filtered = allSubmissions;

    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter((s) => s.status === statusFilter);
    }

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(
        (s) =>
          s.eventData.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.eventData.organization.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.submittedBy.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Sort by submittedAt (newest first)
    return filtered.sort(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
    );
  }, [allSubmissions, statusFilter, searchQuery]);

  return {
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    allSubmissions,
    filteredSubmissions,
  };
}
