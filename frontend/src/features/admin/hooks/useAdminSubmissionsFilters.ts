import { useState, useMemo } from "react";
import { useAdminStore } from "@/features/admin/store/admin.store";
import type { SubmissionStatus } from "@/shared/types";

interface UseAdminSubmissionsFiltersOptions {
  getClubName: (clubId: number | null | undefined) => string;
}

export function useAdminSubmissionsFilters({
  getClubName,
}: UseAdminSubmissionsFiltersOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [school, setSchool] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SubmissionStatus>("all");
  const allSubmissions = useAdminStore((s) => s.submissions);

  const filteredSubmissions = useMemo(() => {
    let filtered = allSubmissions;
    if (school) filtered = filtered.filter(submission => submission.school === school);

    if (statusFilter !== "all") {
      filtered = filtered.filter((s) => s.status === statusFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.eventData.title.toLowerCase().includes(query) ||
          getClubName(s.eventData.club_id).toLowerCase().includes(query) ||
          s.submittedBy.toLowerCase().includes(query),
      );
    }

    return filtered.toSorted(
      (a, b) =>
        new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    );
  }, [allSubmissions, statusFilter, searchQuery, getClubName, school]);

  return {
    school,
    setSchool,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    allSubmissions,
    filteredSubmissions,
  };
}
