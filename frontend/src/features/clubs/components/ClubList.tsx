import { useMemo, type ReactNode } from "react";
import { useProgressiveList } from "@/shared/hooks/useProgressiveList";
import { controlBox } from "@/shared/config/controlBox";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { CardEntrance } from "@/shared/ui/card-entrance";
import { ClubCard } from "@/features/clubs/components/ClubCard";
import { ClubCardSkeleton } from "@/features/clubs/components/ClubCardSkeleton";
import type { Club } from "@/shared/types";

interface ClubListProps {
  clubs: Club[];
  savedClubIds: number[];
  isLoading?: boolean;
  onClubClick?: (club: Club) => void;
  onCategoryClick?: (category: string) => void;
  /** The reader's query; only a change here returns the list to its first batch. */
  resetKey?: string;
}

export function ClubList({
  clubs,
  savedClubIds,
  isLoading = false,
  onClubClick,
  onCategoryClick,
  resetKey,
}: ClubListProps) {
  const savedSet = useMemo(() => new Set(savedClubIds), [savedClubIds]);
  const { visibleItems, hasMore, loadMoreRef } = useProgressiveList(clubs, controlBox.clubManagement.initialRenderCount, resetKey);

  if (isLoading) {
    return (
      <div className={CARD_GRID_CLASS} aria-busy="true">
        {Array.from({ length: controlBox.clubManagement.initialRenderCount }, (_, index) => (
          <ClubCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (clubs.length === 0) {
    return null;
  }

  return (
    <div
      data-slot="card-grid"
      className={CARD_GRID_CLASS}
      role="list"
      aria-label={`${clubs.length} clubs found`}
    >
      {visibleItems.map((club, index) => (
        <CardEntrance
          key={club.id}
          entryKey={`club-${club.id}`}
          index={index}
          role="listitem"
          className="h-full min-w-0"
        >
          <ClubCard
            club={club}
            isSaved={savedSet.has(club.id)}
            onClubClick={onClubClick}
            onCategoryClick={onCategoryClick}
            // The first batch is the server-rendered first screen.
            logoPriority={index < controlBox.clubManagement.initialRenderCount}
          />
        </CardEntrance>
      ))}
      {hasMore && <div ref={loadMoreRef} data-testid="club-list-sentinel"><ClubCardSkeleton /></div>}
    </div>
  );
}

export function ClubListEmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-4">
      <div className="size-16 rounded-full bg-secondary flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground text-center max-w-md">{description}</p>
    </div>
  );
}
