import { useState, useMemo } from "react";
import { useAdminStore } from "@/features/admin/store/admin.store";
import type { SubmissionStatus } from "@/shared/types";

interface UseAdminSubmissionsFiltersOptions {
  getOrganizationName: (organizationId: number | null | undefined) => string;
}

export function useAdminSubmissionsFilters({
  getOrganizationName,
}: UseAdminSubmissionsFiltersOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SubmissionStatus>("all");
  const allSubmissions = useAdminStore((s) => s.submissions);

  const filteredSubmissions = useMemo(() => {
    let filtered = allSubmissions;

    if (statusFilter !== "all") {
      filtered = filtered.filter((s) => s.status === statusFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.eventData.title.toLowerCase().includes(query) ||
          getOrganizationName(s.eventData.organization_id).toLowerCase().includes(query) ||
          s.submittedBy.toLowerCase().includes(query),
      );
    }

    return filtered.toSorted(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );
  }, [allSubmissions, statusFilter, searchQuery, getOrganizationName]);

  return {
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    allSubmissions,
    filteredSubmissions,
  };
}
