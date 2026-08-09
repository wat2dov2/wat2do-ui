import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { getPositionsPage } from "@/features/positions/api/positions.api";
import { useEventsStore } from "@/features/events/store/events.store";
import { resolveSchool } from "@/shared/constants/schools";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { Position, PositionType } from "@/shared/types";

type PositionTypeFilter = PositionType | "all";

interface UsePositionsPageOptions {
  initialDirectory: PaginatedPositionsResponse | null;
  initialSchool: string;
}

function uniquePositions(positions: Position[]): Position[] {
  const seen = new Set<number>();
  return positions.filter((position) => {
    if (seen.has(position.id)) return false;
    seen.add(position.id);
    return true;
  });
}

export function usePositionsPage({
  initialDirectory,
  initialSchool,
}: UsePositionsPageOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [positionType, setPositionType] = useState<PositionTypeFilter>("all");
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const schoolFilter = useEventsStore((state) => state.schoolFilter);
  const school = resolveSchool(schoolFilter ?? initialSchool);
  const pageSize = initialDirectory?.page_size;
  const filters = useMemo(
    () => ({
      school,
      search: submittedSearchQuery,
      positionType,
      pageSize: pageSize ?? null,
    }),
    [pageSize, positionType, school, submittedSearchQuery],
  );
  const canUseInitialDirectory =
    initialDirectory != null &&
    school === resolveSchool(initialSchool) &&
    !submittedSearchQuery &&
    positionType === "all";

  const query = useInfiniteQuery({
    queryKey: queryKeys.positions.list(filters),
    queryFn: ({ pageParam }) =>
      getPositionsPage({
        page: pageParam,
        pageSize,
        school,
        search: submittedSearchQuery || undefined,
        positionType: positionType === "all" ? undefined : positionType,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    initialData: canUseInitialDirectory
      ? { pages: [initialDirectory], pageParams: [1] }
      : undefined,
  });

  const pages = query.data?.pages ?? [];
  const positions = uniquePositions(pages.flatMap((page) => page.items));
  const total = pages[pages.length - 1]?.total ?? 0;

  const submitSearch = useCallback(() => {
    setSubmittedSearchQuery(searchQuery.trim());
  }, [searchQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSubmittedSearchQuery("");
  }, []);

  const loadMore = useCallback(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    void query.fetchNextPage();
  }, [query]);

  return {
    positions,
    total,
    searchQuery,
    setSearchQuery,
    submitSearch,
    clearSearch,
    positionType,
    setPositionType,
    selectedPosition,
    openPosition: setSelectedPosition,
    closePosition: () => setSelectedPosition(null),
    isLoading: query.isLoading,
    isLoadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage ?? false,
    loadMore,
  };
}
