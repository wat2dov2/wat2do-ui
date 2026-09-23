import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PaginatedPositionsResponse } from "@/features/positions/api/positions.api";
import { getPositionDirectory } from "@/features/positions/api/positions.api";
import { useEventsStore } from "@/features/events/store/events.store";
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
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [positionType, setPositionType] = useState<PositionTypeFilter>("all");
  const [addedSince, setAddedSince] = useState<string | null>(null);
  const [paidOnly, setPaidOnly] = useState(false);
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const schoolFilter = useEventsStore((state) => state.schoolFilter);
  const school = resolveSchool(schoolFilter ?? initialSchool);
  const query = useQuery({
    queryKey: queryKeys.positions.allForSchool(school),
    retry: false,
    queryFn: () => getPositionDirectory(school),
    initialData: school === resolveSchool(initialSchool) ? initialDirectory ?? undefined : undefined,
  });
  const positions = useMemo(
    () => filterPositions(query.data?.items ?? [], {
      search: submittedSearchQuery,
      positionType,
      paidOnly,
      addedSince,
    }),
    [query.data, submittedSearchQuery, positionType, paidOnly, addedSince],
  );
  const selectedPosition = query.data?.items.find(position => position.id === selectedPositionId) ?? null;
  const total = positions.length;

  const submitSearch = useCallback(() => {
    setSubmittedSearchQuery(searchQuery.trim());
  }, [searchQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setSubmittedSearchQuery("");
  }, []);

  return {
    positions,
    total,
    latestAddedPosition: query.data?.latest_added_position ?? null,
    searchLatest: () => {
      const latest = query.data?.latest_added_position;
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
    openPosition: (position: Position) => setSelectedPositionId(position.id),
    closePosition: () => setSelectedPositionId(null),
    isLoading: query.isLoading,
    isError: query.isError,
    retry: () => void query.refetch(),
  };
}
