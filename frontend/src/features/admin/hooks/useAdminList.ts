import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { PaginatedApiResponse } from "@/shared/services/apiClient";
import { controlBox } from "@/shared/config/controlBox";
import { ADMIN_ITEMS_PER_PAGE } from "@/features/admin/constants";
import {
  getReportedEvents,
  getEventSubmissions,
  getClubClaims,
  getClubSubmissions,
  type AdminListFilters,
} from "@/features/admin/api/admin.api";

const moderationLoaders = {
  reports: getReportedEvents,
  submissions: getEventSubmissions,
  claims: getClubClaims,
  clubSubmissions: getClubSubmissions,
};
type ModerationResource = keyof typeof moderationLoaders;

export function useAdminList<T>(
  resource: string,
  loadPage: (filters: AdminListFilters) => Promise<PaginatedApiResponse<T>>,
  enabled = true,
  initial: Partial<AdminListFilters> = {},
) {
  const [filters, setFilters] = useState<AdminListFilters>({
    page: 1,
    pageSize: ADMIN_ITEMS_PER_PAGE,
    ...initial,
  });
  const query = useQuery({
    queryKey: queryKeys.admin.list(resource, filters),
    queryFn: () => loadPage(filters),
    enabled,
    staleTime: controlBox.clientCache.adminStaleMs,
  });
  const lastPage = query.data ? Math.max(1, query.data.total_pages) : undefined;
  if (lastPage !== undefined && filters.page > lastPage) {
    setFilters({ ...filters, page: lastPage });
  }
  return {
    ...query,
    filters,
    setFilters: (changes: Partial<AdminListFilters>) =>
      setFilters(previous => ({ ...previous, page: 1, ...changes })),
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    pagination: {
      currentPage: filters.page,
      totalPages: query.data?.total_pages ?? 1,
      onPageChange: (page: number) => setFilters(previous => ({ ...previous, page })),
    },
  };
}

export function useAdminPendingCounts(resources: ModerationResource[]) {
  const queries = useQueries({
    queries: resources.map(resource => ({
      queryKey: queryKeys.admin.count(resource),
      queryFn: async () => (await moderationLoaders[resource]({
        page: 1,
        pageSize: 1,
        status: "pending",
      })).total,
      staleTime: controlBox.clientCache.adminStaleMs,
    })),
  });
  return {
    counts: Object.fromEntries(resources.map((resource, index) => [resource, queries[index].data])) as Partial<Record<ModerationResource, number>>,
    isError: queries.some(query => query.isError),
    refetch: () => Promise.all(queries.map(query => query.refetch())),
  };
}
