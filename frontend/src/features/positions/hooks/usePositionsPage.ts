import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { getPositionDirectory } from "@/features/positions/api/positions.api";
import { useDiscoveryQueryTracking } from "@/shared/hooks/useDiscoveryQueryTracking";
import { resolveSchool } from "@/shared/constants/schools";
import { filterPositions } from "@/features/positions/api/positionService";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { Position, PositionType } from "@/shared/types";

type PositionTypeFilter = PositionType | "all";

interface UsePositionsPageOptions {
  initialDirectory: PaginatedPositionsResponse | null;
  initialSchool: string;
}

export function usePositionsPage({
  initialDirectory,
  initialSchool,
}: UsePositionsPageOptions) {
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState({ query: "", revision: 0 });
  const [positionType, setPositionType] = useState<PositionTypeFilter>("all");
  const [addedSince, setAddedSince] = useState<string | null>(null);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const school = resolveSchool(initialSchool);
  const query = useQuery({
    queryKey: queryKeys.positions.allForSchool(school),
    retry: false,
    queryFn: () => getPositionDirectory(school),
    initialData: initialDirectory ?? undefined,
  });
  const positions = useMemo(
    () => filterPositions(query.data?.items ?? [], {
      search: submittedSearch.query,
      positionType,
      addedSince,
    }),
    [query.data, submittedSearch.query, positionType, addedSince],
  );
  const selectedPosition = query.data?.items.find(position => position.id === selectedPositionId) ?? null;
  const total = positions.length;

  useDiscoveryQueryTracking({
    school,
    surface: "positions",
    search_query: submittedSearch.query,
    filters: { positionType, addedSince },
  }, submittedSearch.revision);

  const submitSearch = useCallback(() => {
    setSubmittedSearch(previous => ({ query: searchQuery.trim(), revision: previous.revision + 1 }));
  }, [searchQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSubmittedSearch(previous => ({ query: "", revision: previous.revision + 1 }));
  }, []);

  return {
    positions,
    total,
    latestAddedPosition: query.data?.latest_added_position ?? null,
    searchLatest: () => {
      const latest = query.data?.latest_added_position;
      if (!latest) return;
      setSearchQuery(latest.title);
      setSubmittedSearch(previous => ({ query: latest.title, revision: previous.revision + 1 }));
      setPositionType("all");
      setAddedSince(null);
    },
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
    openPosition: (position: Position) => setSelectedPositionId(position.id),
    closePosition: () => setSelectedPositionId(null),
    isLoading: query.isLoading,
    isError: query.isLoadingError,
    retry: () => void query.refetch(),
  };
}
