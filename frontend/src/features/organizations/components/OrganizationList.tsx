import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/shared/ui/spinner";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
import { CardEntrance } from "@/shared/ui/card-entrance";
import { OrganizationCard } from "@/features/organizations/components/OrganizationCard";
import { OrganizationCardSkeleton } from "@/features/organizations/components/OrganizationCardSkeleton";
import type { Organization } from "@/shared/types";

interface OrganizationListProps {
  organizations: Organization[];
  savedOrganizationIds: number[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onOrganizationClick?: (organization: Organization) => void;
  onCategoryClick?: (category: string) => void;
}

export function OrganizationList({
  organizations,
  savedOrganizationIds,
  isLoading = false,
  isLoadingMore = false,
  hasMore = false,
  onLoadMore,
  onOrganizationClick,
  onCategoryClick,
}: OrganizationListProps) {
  const { t } = useTranslation();
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const savedSet = new Set(savedOrganizationIds);

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
          <OrganizationCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (organizations.length === 0) {
    return null;
  }

  return (
    <>
      <div
        data-slot="card-grid"
        className={CARD_GRID_CLASS}
        role="list"
        aria-label={`${organizations.length} organizations found`}
      >
        {organizations.map((organization, index) => (
          <CardEntrance
            key={organization.id}
            index={index}
            role="listitem"
            className="h-full min-w-0"
          >
            <OrganizationCard
              organization={organization}
              isSaved={savedSet.has(organization.id)}
              onOrganizationClick={onOrganizationClick}
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

export function OrganizationListEmptyState({
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
