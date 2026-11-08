"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { PositionCard } from "@/features/positions/components/PositionCard";
import { PositionDetailsDrawer } from "@/features/positions/components/PositionDetailsDrawer";
import { PositionCardSkeleton } from "@/features/positions/components/PositionList";
import { usePositionStats } from "@/features/positions/hooks/usePositionStats";
import { ROUTES } from "@/shared/constants/routes";
import { CardCarousel } from "@/shared/layout/card-carousel";
import type { Position } from "@/shared/types";

/** Placeholders while the row loads: more than any screen shows at once. */
const PLACEHOLDER_COUNT = 6;

interface OpenPositionsCarouselProps {
  school: string;
  /** The row's positions, read by the server with the page; the page leaves the row out when there are none. */
  positions: Position[];
}

/** A row of the school's open positions, each opening in the positions page's drawer. */
export function OpenPositionsCarousel({ school, positions }: OpenPositionsCarouselProps) {
  const { t } = useTranslation();
  const { data: stats } = usePositionStats(school);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hasOpenedDetails, setHasOpenedDetails] = useState(false);
  const selected = positions.find(position => position.id === selectedId) ?? null;
  const openPosition = useCallback((position: Position) => {
    setHasOpenedDetails(true);
    setSelectedId(position.id);
  }, []);

  return (
    <>
      <CardCarousel title={t("positions.openPositions")} seeAll={{ href: ROUTES.POSITIONS }}>
        {positions.map(position => (
          <PositionCard
            key={position.id}
            position={position}
            onPositionClick={openPosition}
            clickCount={stats?.[String(position.id)]?.click_count}
          />
        ))}
      </CardCarousel>
      {/* Mounted at the first open and kept, so the drawer can animate closed. */}
      {hasOpenedDetails ? (
        <PositionDetailsDrawer
          positions={positions}
          onSelect={openPosition}
          position={selected}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </>
  );
}

/** The row before the page's data arrives, box for box; nothing is fetched. */
export function OpenPositionsCarouselSkeleton() {
  const { t } = useTranslation();
  return (
    <CardCarousel title={t("positions.openPositions")} busy>
      {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => <PositionCardSkeleton key={index} />)}
    </CardCarousel>
  );
}
