import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getClubsPaginated } from "@/features/clubs/api/clubs.api";
import { queryKeys } from "@/shared/lib/queryKeys";

type UseClubsListOptions = Pick<Parameters<typeof getClubsPaginated>[0], "limit" | "search" | "clubType">;

/** Admin pagination; public discovery uses the complete school directory. */
export function useClubsList(options: UseClubsListOptions) {
  const queryClient = useQueryClient();
  const listQueryKey = queryKeys.clubs.list(options);
  const listQueryKeyString = JSON.stringify(listQueryKey);
  const [pageState, setPageState] = useState({ key: "", page: 1 });
  const currentPage = pageState.key === listQueryKeyString ? pageState.page : 1;
  const setCurrentPage = (page: number) => {
    setPageState({ key: listQueryKeyString, page });
  };
  const query = useQuery({
    queryKey: [...listQueryKey, "page", currentPage],
    queryFn: () => getClubsPaginated({ ...options, page: currentPage }),
    retry: false,
  });
  return {
    clubs: query.data?.items ?? [],
    totalItems: query.data?.total ?? 0,
    totalPages: query.data?.total_pages ?? 0,
    isLoading: query.isLoading,
    currentPage,
    setCurrentPage,
    refresh: () => void queryClient.invalidateQueries({ queryKey: listQueryKey }),
  };
}
