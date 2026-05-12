import { useState, useMemo } from "react";
import { useAdminStore } from "@/features/admin/store/admin.store";
import type { SubmissionStatus } from "@/shared/types";

/**
 * Hook for managing filters in AdminSubmissionsPage.
 *
 * Reads the submissions list from the admin store, which owns the fetch
 * + TTL. The store's mutation actions (approve/reject) patch the local
 * list on success so no refreshKey is needed.
 */
export function useAdminSubmissionsFilters() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SubmissionStatus>("all");
  const allSubmissions = useAdminStore((s) => s.submissions);

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
    return filtered.toSorted(
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
