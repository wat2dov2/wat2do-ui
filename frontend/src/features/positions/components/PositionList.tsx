import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CardEntrance } from "@/shared/ui/card-entrance";
import { Skeleton } from "@/shared/ui/skeleton";
import { EventCardContentFrame } from "@/shared/ui/event-card-content";
import { Spinner } from "@/shared/ui/spinner";
import { Users } from "@/shared/ui/doodle-icons";
import { EmptyState } from "@/shared/feedback/empty-state";
import {
  CARD_GRID_CLASS,
  EVENT_CARD_IMAGE_HEIGHT,
} from "@/shared/constants/ui";
import { PositionCard } from "@/features/positions/components/PositionCard";
import type { Position } from "@/shared/types";

interface PositionListProps {
  positions: Position[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onPositionClick: (position: Position) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}

function PositionCardSkeleton() {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl">
      <Skeleton
        className="w-full rounded-t-xl rounded-br-xl"
        style={{ height: EVENT_CARD_IMAGE_HEIGHT }}
      />
      <EventCardContentFrame className="gap-3 py-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </EventCardContentFrame>
    </div>
  );
}

export function PositionList({
  positions,
  isLoading,
  isLoadingMore,
  hasMore,
  onLoadMore,
  onPositionClick,
  emptyTitle,
  emptyDescription,
}: PositionListProps) {
  const { t } = useTranslation();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || isLoadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { threshold: 0.1 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

  if (isLoading) {
    return (
      <div className={CARD_GRID_CLASS} aria-busy="true">
        {Array.from({ length: 8 }).map((_, index) => (
          <PositionCardSkeleton key={index} />
        ))}
      </div>
    );
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
    <>
      <div
        data-slot="card-grid"
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
            />
          </CardEntrance>
        ))}
      </div>
      {hasMore ? (
        <div ref={loadMoreRef} className="flex justify-center py-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-5" />
            <span>{t("common.loading")}</span>
          </div>
        </div>
      ) : null}
    </>
  );
}
