"use client";

import { useCallback, useMemo, useState } from "react";
import { PositionDetailsDrawer } from "@/features/positions/components/PositionDetailsDrawer";
import { PositionList } from "@/features/positions/components/PositionList";
import type { Position } from "@/shared/types";

interface PositionsGridProps {
  positions: Position[];
  isPending: boolean;
  emptyTitle: string;
  emptyDescription: string;
}

/** A grid of position cards that opens each one in the position drawer, outside the positions page. */
export function PositionsGrid({ positions, isPending, emptyTitle, emptyDescription }: PositionsGridProps) {
  const [selectedPositionId, setSelectedPositionId] = useState<number | null>(null);
  const selectedPosition = useMemo(
    () => positions.find((position) => position.id === selectedPositionId) ?? null,
    [positions, selectedPositionId],
  );
  const handlePositionClick = useCallback((position: Position) => {
    setSelectedPositionId(position.id);
  }, []);
  const handleClose = useCallback(() => {
    setSelectedPositionId(null);
  }, []);

  return (
    <>
      <PositionList
        positions={positions}
        isLoading={isPending}
        onPositionClick={handlePositionClick}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
      <PositionDetailsDrawer
        positions={positions}
        onSelect={handlePositionClick}
        position={selectedPosition}
        onClose={handleClose}
      />
    </>
  );
}
