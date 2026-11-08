"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { positionDirectoryQueryOptions } from "@/features/positions/api/positions.api";
import { PositionCard } from "@/features/positions/components/PositionCard";
import { PositionDetailsDrawer } from "@/features/positions/components/PositionDetailsDrawer";
import { PositionCardSkeleton } from "@/features/positions/components/PositionList";
import { usePositionStats } from "@/features/positions/hooks/usePositionStats";
import { controlBox } from "@/shared/config/controlBox";
import { ROUTES } from "@/shared/constants/routes";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { CardCarousel } from "@/shared/layout/card-carousel";
import type { Position } from "@/shared/types";

/** The directory loads as the row nears the screen, not with the page above it. */
const LOAD_MARGIN = "600px";
/** Placeholders while it loads: more than any screen shows at once. */
const PLACEHOLDER_COUNT = 6;

const placeholders = () => Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => <PositionCardSkeleton key={index} />);

/** A row of the school's open positions, each opening in the positions page's drawer. */
export function OpenPositionsCarousel({ school }: { school: string }) {
  const { t } = useTranslation();
  const { ref, hasIntersected } = useIntersectionObserver<HTMLDivElement>({ rootMargin: LOAD_MARGIN });
  const { data, isError } = useQuery({ ...positionDirectoryQueryOptions(school), enabled: hasIntersected });
  const positions = useMemo(
    () => data?.items.slice(0, controlBox.eventDiscovery.highlights.rowCardCount) ?? [],
    [data],
  );
  const { data: stats } = usePositionStats(positions.length > 0 ? school : "");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hasOpenedDetails, setHasOpenedDetails] = useState(false);
  const selected = positions.find(position => position.id === selectedId) ?? null;
  const openPosition = useCallback((position: Position) => {
    setHasOpenedDetails(true);
    setSelectedId(position.id);
  }, []);

  // A school with no open positions, or a directory that failed to load, has no row.
  if (isError || (data && positions.length === 0)) return null;

  return (
    <div ref={ref}>
      <CardCarousel title={t("positions.openPositions")} seeAll={{ href: ROUTES.POSITIONS }} busy={!data}>
        {data
          ? positions.map(position => (
            <PositionCard
              key={position.id}
              position={position}
              onPositionClick={openPosition}
              clickCount={stats?.[String(position.id)]?.click_count}
            />
          ))
          : placeholders()}
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
    </div>
  );
}

/** The row before the page's data arrives, box for box; nothing is fetched. */
export function OpenPositionsCarouselSkeleton() {
  const { t } = useTranslation();
  return (
    <CardCarousel title={t("positions.openPositions")} busy>
      {placeholders()}
    </CardCarousel>
  );
}
