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
  const [addedSince, setAddedSince] = useState<string | null>(null);
  const [paidOnly, setPaidOnly] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const schoolFilter = useEventsStore((state) => state.schoolFilter);
  const school = resolveSchool(schoolFilter ?? initialSchool);
  const pageSize = initialDirectory?.page_size;
  const filters = useMemo(
    () => ({
      school,
      search: submittedSearchQuery,
      positionType,
      addedSince,
      paidOnly,
      pageSize: pageSize ?? null,
    }),
    [addedSince, paidOnly, pageSize, positionType, school, submittedSearchQuery],
  );
  const canUseInitialDirectory =
    initialDirectory != null &&
    school === resolveSchool(initialSchool) &&
    !submittedSearchQuery &&
    positionType === "all" && addedSince === null && !paidOnly;

  const query = useInfiniteQuery({
    queryKey: queryKeys.positions.list(filters),
    queryFn: ({ pageParam }) =>
      getPositionsPage({
        page: pageParam,
        pageSize,
        school,
        search: submittedSearchQuery || undefined,
        positionType: positionType === "all" ? undefined : positionType,
        addedSince: addedSince ?? undefined,
        paidOnly,
      }),
    initialPageParam: 1,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2].school === school ? previous : undefined,
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
    if (!query.hasNextPage || query.isFetchingNextPage || query.isPlaceholderData) return;
    void query.fetchNextPage();
  }, [query]);

  return {
    positions,
    total,
    latestAddedPosition: pages[0]?.latest_added_position ?? null,
    searchLatest: () => {
      const latest = pages[0]?.latest_added_position;
      if (!latest) return;
      setSearchQuery(latest.title);
      setSubmittedSearchQuery(latest.title);
      setPositionType("all");
      setAddedSince(null);
      setPaidOnly(false);
    },
    paidOnly,
    setPaidOnly,
    searchQuery,
    setSearchQuery,
    submitSearch,
    clearSearch,
    positionType,
    setPositionType,
    addedSince,
    setAddedSince,
    clearNew: () => setAddedSince(null),
    selectedPosition,
    openPosition: setSelectedPosition,
    closePosition: () => setSelectedPosition(null),
    isLoading: query.isLoading,
    isLoadingMore: query.isFetchingNextPage,
    hasMore: !query.isPlaceholderData && (query.hasNextPage ?? false),
    loadMore,
  };
}
