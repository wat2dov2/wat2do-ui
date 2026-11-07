import { usePositionStats } from "@/features/positions/hooks/usePositionStats";
import { useTranslation } from "react-i18next";
import { CardEntrance } from "@/shared/ui/card-entrance";
import { Skeleton } from "@/shared/ui/skeleton";
import { CardImageSkeleton } from "@/shared/ui/card-image-skeleton";
import { Users } from "lucide-react";
import { EmptyState } from "@/shared/feedback/empty-state";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { PositionCard } from "@/features/positions/components/PositionCard";
import type { Position } from "@/shared/types";
import imageDelivery from "../../../../../backend/controlbox/image_delivery.json" with { type: "json" };

interface PositionListProps {
  positions: Position[];
  isLoading: boolean;
  onPositionClick: (position: Position) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** Mirrors EventCardSkeleton: two title lines, then the description beneath. */
function PositionCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl" data-skeleton-key="card">
      <CardImageSkeleton />
      <div className="flex flex-1 flex-col gap-2.5 pb-2.5 pt-3 sm:gap-3 sm:pb-3 sm:pt-4">
        <div className="space-y-1.5" data-skeleton-key="card-title">
          <Skeleton className="h-4 w-3/4 rounded-lg" />
          <Skeleton className="h-4 w-1/2 rounded-lg" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-full rounded-lg" />
          <Skeleton className="h-3 w-5/6 rounded-lg" />
          <Skeleton className="h-3 w-2/5 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

/** The grid's loading face, also used while a server-streamed list arrives. */
export function PositionListSkeleton() {
  return (
    <div className={CARD_GRID_CLASS} aria-busy="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <PositionCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function PositionList({
  positions,
  isLoading,
  onPositionClick,
  emptyTitle,
  emptyDescription,
}: PositionListProps) {
  const { t } = useTranslation();
  const { data: stats } = usePositionStats(positions[0]?.school ?? "");
  if (isLoading) {
    return <PositionListSkeleton />;
  }

  if (positions.length === 0) {
    return (
      <EmptyState
        icon={<Users />}
        title={emptyTitle ?? t("positions.emptyTitle")}
        description={emptyDescription ?? t("positions.emptyDescription")}
      />
    );
  }

  return (
    <div
      data-slot="card-grid"
      data-scroll-date-group="positions"
      className={CARD_GRID_CLASS}
      role="list"
      aria-label={t("positions.resultsLabel", { count: positions.length })}
    >
      {positions.map((position, index) => (
        <CardEntrance
          key={position.id}
          index={index}
          role="listitem"
          className="h-full min-w-0"
        >
          <PositionCard
            position={position}
            onPositionClick={onPositionClick}
            clickCount={stats?.[String(position.id)]?.click_count}
            imagePriority={index < imageDelivery.first_row_image_count}
          />
        </CardEntrance>
      ))}
    </div>
  );
}
