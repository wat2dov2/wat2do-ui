import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getClubPositions } from "@/features/positions/api/positions.api";
import { PositionDetailsDrawer } from "@/features/positions/components/PositionDetailsDrawer";
import { PositionList } from "@/features/positions/components/PositionList";
import { queryKeys } from "@/shared/lib/queryKeys";
import type { Position } from "@/shared/types";

interface ClubPositionsGridProps {
  clubId: number;
  school: string;
  initialPositions: Position[];
}

const ignoreLoadMore = () => undefined;

export function ClubPositionsGrid({
  clubId,
  school,
  initialPositions,
}: ClubPositionsGridProps) {
  const { t } = useTranslation();
  const { data: positions, isPending } = useQuery({
    queryKey: queryKeys.positions.byClub(clubId, school),
    queryFn: () => getClubPositions(clubId, school),
    enabled: clubId > 0 && Boolean(school),
    initialData: initialPositions,
  });
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(
    null,
  );
  const selectedPosition = useMemo(
    () =>
      positions.find((position) => position.id === selectedPositionId) ?? null,
    [positions, selectedPositionId],
  );

  const handlePositionClick = useCallback((position: Position) => {
    setSelectedPositionId(position.id);
  }, []);

  const handleClosePositionDetails = useCallback(() => {
    setSelectedPositionId(null);
  }, []);

  return (
    <>
      <PositionList
        positions={positions}
        isLoading={isPending}
        isLoadingMore={false}
        hasMore={false}
        onLoadMore={ignoreLoadMore}
        onPositionClick={handlePositionClick}
        emptyTitle={t("positions.clubEmptyTitle")}
        emptyDescription={t("positions.clubEmptyDescription")}
      />
      <PositionDetailsDrawer
        positions={positions}
        onSelect={handlePositionClick}
        position={selectedPosition}
        onClose={handleClosePositionDetails}
      />
    </>
  );
}
