import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { m } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/shared/ui/spinner";
import { CARD_GRID_CLASS } from "@/shared/constants/ui";
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

interface VisibleOrgAnimationState {
  orgIds: Set<number>;
  animationIndexByOrgId: Map<number, number>;
}

interface OrganizationCardListItemProps {
  animationIndex: number;
  children: ReactNode;
}

const ORG_CARD_ANIMATION_STAGGER_MS = 50;

function OrganizationCardListItem({
  animationIndex,
  children,
}: OrganizationCardListItemProps) {
  // Cap the stagger animation index to 15 to keep it performant
  const cappedIndex = Math.min(animationIndex, 15);

  return (
    <m.div
      role="listitem"
      className="min-w-0"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        delay: cappedIndex * (ORG_CARD_ANIMATION_STAGGER_MS / 1000),
        ease: [0.18, 0.39, 0.14, 0.9],
      }}
      style={{ pointerEvents: "auto" }}
    >
      {children}
    </m.div>
  );
}

function hasSameOrgIds(orgs: Organization[], orgIds: Set<number>): boolean {
  return orgs.length === orgIds.size && orgs.every((org) => orgIds.has(org.id));
}

function getOrgIds(orgs: Organization[]): Set<number> {
  return new Set(orgs.map((org) => org.id));
}

function getNewOrgAnimationIndexById(
  orgs: Organization[],
  previousOrgIds: Set<number>,
): Map<number, number> {
  const animationIndexByOrgId = new Map<number, number>();

  orgs.forEach((org) => {
    if (!previousOrgIds.has(org.id)) {
      animationIndexByOrgId.set(org.id, animationIndexByOrgId.size);
    }
  });

  return animationIndexByOrgId;
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

  const [visibleOrgAnimation, setVisibleOrgAnimation] = useState<VisibleOrgAnimationState>(
    () => ({
      orgIds: new Set(),
      animationIndexByOrgId: new Map(),
    }),
  );

  if (!hasSameOrgIds(organizations, visibleOrgAnimation.orgIds)) {
    setVisibleOrgAnimation({
      orgIds: getOrgIds(organizations),
      animationIndexByOrgId: getNewOrgAnimationIndexById(
        organizations,
        visibleOrgAnimation.orgIds,
      ),
    });
  }

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
      <div className={CARD_GRID_CLASS}>
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
        className={CARD_GRID_CLASS}
        role="list"
        aria-label={`${organizations.length} organizations found`}
      >
        {organizations.map((organization) => (
          <OrganizationCardListItem
            key={organization.id}
            animationIndex={visibleOrgAnimation.animationIndexByOrgId.get(organization.id) ?? 0}
          >
            <OrganizationCard
              organization={organization}
              isSaved={savedSet.has(organization.id)}
              onOrganizationClick={onOrganizationClick}
              onCategoryClick={onCategoryClick}
            />
          </OrganizationCardListItem>
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
