import { useState, useMemo, useEffect } from "react";
import { getEventSubmissions } from "@/features/admin/api/admin.api";
import type { EventSubmission, SubmissionStatus } from "@/shared/types";

interface UseAdminSubmissionsFiltersOptions {
  refreshKey: number;
}

/**
 * Hook for managing filters in AdminSubmissionsPage
 */
export function useAdminSubmissionsFilters({ refreshKey }: UseAdminSubmissionsFiltersOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SubmissionStatus>("all");
  const [allSubmissions, setAllSubmissions] = useState<EventSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch submissions from backend
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    getEventSubmissions()
      .then((data) => {
        if (!cancelled) setAllSubmissions(data);
      })
      .catch((err) => console.error("Failed to fetch submissions:", err))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
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
    isLoading,
  };
}
