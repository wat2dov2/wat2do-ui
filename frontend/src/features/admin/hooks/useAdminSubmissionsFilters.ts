import { getEventSubmissions } from "@/features/admin/api/admin.api";
import { useAdminList } from "@/features/admin/hooks/useAdminList";
import type { SubmissionStatus } from "@/shared/types";

export function useAdminSubmissionsFilters(enabled: boolean) {
  const list = useAdminList("submissions", getEventSubmissions, enabled);
  return {
    ...list,
    searchQuery: list.filters.search ?? "", school: list.filters.school ?? "", statusFilter: list.filters.status ?? "all",
    setSearchQuery: (search: string) => list.setFilters({ search }),
    setSchool: (school: string) => list.setFilters({ school }),
    setStatusFilter: (status: "all" | SubmissionStatus) => list.setFilters({ status }),
  };
}
