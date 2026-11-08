import { usePositionStats } from "@/features/positions/hooks/usePositionStats";
import { useTranslation } from "react-i18next";
import { CardEntrance } from "@/shared/ui/card-entrance";
import { CardImageSkeleton } from "@/shared/ui/card-image-skeleton";
import { EventCardContentFrame, EventCardContentSkeleton } from "@/shared/ui/event-card-content";
import { Users } from "lucide-react";
import { EmptyState } from "@/shared/feedback/empty-state";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { PositionCard } from "@/features/positions/components/PositionCard";
import type { Position } from "@/shared/types";
import { controlBox } from "@/shared/config/controlBox";
import imageDelivery from "../../../../../backend/controlbox/image_delivery.json" with { type: "json" };

interface PositionListProps {
  positions: Position[];
  isLoading: boolean;
  onPositionClick: (position: Position) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

/** The position card before it loads: artwork, a one-line title, its stats line and description. */
export function PositionCardSkeleton() {
  return (
    <div className="flex h-full w-full flex-col rounded-xl" data-skeleton-key="card">
      <CardImageSkeleton />
      <EventCardContentFrame>
        <EventCardContentSkeleton titleLines={1} descriptionLines={2} metadataLines={0} />
      </EventCardContentFrame>
    </div>
  );
}

/** The grid's loading face, also used while a server-streamed list arrives. */
export function PositionListSkeleton() {
  return (
    <div className={CARD_GRID_CLASS} aria-busy="true">
      {Array.from({ length: controlBox.eventDiscovery.initialRenderCount }, (_, index) => (
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
          entryKey={`position-${position.id}`}
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
