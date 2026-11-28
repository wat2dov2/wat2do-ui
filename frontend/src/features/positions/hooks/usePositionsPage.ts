import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useQuery } from "@tanstack/react-query";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { positionDirectoryQueryOptions } from "@/features/positions/api/positions.api";
import { useDiscoveryQueryTracking } from "@/shared/hooks/useDiscoveryQueryTracking";
import { resolveSchool } from "@/shared/constants/schools";
import { filterPositions } from "@/features/positions/api/positionService";
import type { Position } from "@/shared/types";
import { discoverySnapshotSeed } from "@/shared/api/discovery.api";
import { NO_POSITION_FILTERS, usePositionFiltersStore, type PositionFilters } from "@/features/positions/store/positionFilters.store";

interface UsePositionsPageOptions {
  initialDirectory: PaginatedPositionsResponse | null;
  initialSchool: string;
}

export function usePositionsPage({
  initialDirectory,
  initialSchool,
}: UsePositionsPageOptions) {
  // The search and filters outlive the page, so coming Back from a club finds them as they were.
  const { searchQuery, submittedSearch, filters, setSearchQuery, submitSearch, clearSearch, searchFor, setFilters } =
    usePositionFiltersStore(useShallow((s) => s));
  const { positionType, addedSince } = filters;
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const school = resolveSchool(initialSchool);
  const query = useQuery({
    ...positionDirectoryQueryOptions(school),
    ...discoverySnapshotSeed(initialDirectory),
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

  return {
    appliedQueryKey: JSON.stringify({ submittedSearch, filters }),
    positions,
    total,
    latestAddedPosition: query.data?.latest_added_position ?? null,
    searchLatest: () => {
      const latest = query.data?.latest_added_position;
      if (!latest) return;
      searchFor(latest.title, NO_POSITION_FILTERS);
    },
    searchQuery,
    setSearchQuery,
    submitSearch,
    clearSearch,
    positionType,
    setPositionType: (value: PositionFilters["positionType"]) => setFilters({ positionType: value }),
    addedSince,
    setAddedSince: (value: string | null) => setFilters({ addedSince: value }),
    clearNew: () => setFilters({ addedSince: null }),
    selectedPosition,
    openPosition: (position: Position) => setSelectedPositionId(position.id),
    closePosition: () => setSelectedPositionId(null),
    isLoading: query.isLoading,
    isError: query.isLoadingError,
    retry: () => void query.refetch(),
  };
}
