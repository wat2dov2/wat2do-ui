import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/shared/ui/spinner";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { CardEntrance } from "@/shared/ui/card-entrance";
import { ClubCard } from "@/features/clubs/components/ClubCard";
import { ClubCardSkeleton } from "@/features/clubs/components/ClubCardSkeleton";
import type { Club } from "@/shared/types";

interface ClubListProps {
  clubs: Club[];
  savedClubIds: number[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onClubClick?: (club: Club) => void;
  onCategoryClick?: (category: string) => void;
}

export function ClubList({
  clubs,
  savedClubIds,
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  onLoadMore,
  onClubClick,
  onCategoryClick,
}: ClubListProps) {
  const { t } = useTranslation();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const savedSet = new Set(savedClubIds);

  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting) {
          onLoadMore();
        }
      },
      { threshold: 0.1 },
    );

    const currentRef = loadMoreRef.current;
    if (currentRef) {
      observer.observe(currentRef);
    }

    return () => {
      if (currentRef) {
        observer.unobserve(currentRef);
      }
    };
  }, [onLoadMore, hasMore, isLoadingMore]);

  if (isLoading) {
    return (
      <div className={CARD_GRID_CLASS} aria-busy="true">
        {Array.from({ length: 12 }).map((_, index) => (
          <ClubCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (clubs.length === 0) {
    return null;
  }

  return (
    <>
      <div
        data-slot="card-grid"
        className={CARD_GRID_CLASS}
        role="list"
        aria-label={`${clubs.length} clubs found`}
      >
        {clubs.map((club, index) => (
          <CardEntrance
            key={club.id}
            index={index}
            role="listitem"
            className="h-full min-w-0"
          >
            <ClubCard
              club={club}
              isSaved={savedSet.has(club.id)}
              onClubClick={onClubClick}
              onCategoryClick={onCategoryClick}
            />
          </CardEntrance>
        ))}
      </div>
      {hasMore && (
        <div ref={loadMoreRef} className="flex justify-center py-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="size-5" />
            <span>{t("common.loading")}</span>
          </div>
        </div>
      )}
    </>
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
