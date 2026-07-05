import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  ExternalLink,
  MoreHorizontal,
} from "@/shared/ui/doodle-icons";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { getCategoryClasses, translateCategory } from "@/shared/utils/event";
import { getEventCardWaterpaintStyle } from "@/shared/utils/eventCardWaterpaint";
import { sanitizeHref } from "@/shared/utils/url";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { useProfileCompleted } from "@/features/auth";
import { useCardMouseDownActivate } from "@/shared/hooks";
import { OrganizationOverflowMenu } from "@/features/organizations/components/OrganizationOverflowMenu";
import {
  formatOrganizationLastPosted,
  getOrganizationEventCountBadge,
  getOrganizationSocialHandle,
} from "@/features/organizations/utils/organizationCardContent";
import type { Organization } from "@/shared/types";

interface OrganizationCardProps {
  organization: Organization;
  isSaved?: boolean;
  onOrganizationClick?: (organization: Organization) => void;
  onCategoryClick?: (category: string) => void;
}

type CategoryClasses = ReturnType<typeof getCategoryClasses>;

function getOrganizationPrimaryCategory(organization: Organization): string {
  return organization.categories[0] ?? "";
}

interface OrganizationCategoryBadgeProps {
  primaryCategory: string;
  categoryClasses: CategoryClasses;
  badgeHoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  onCategoryClick: (event: React.MouseEvent) => void;
  t: (key: string) => string;
}

function OrganizationCategoryBadge({
  primaryCategory,
  categoryClasses,
  badgeHoverProps,
  onCategoryClick,
  t,
}: OrganizationCategoryBadgeProps) {
  if (!primaryCategory) {
    return null;
  }

  return (
    <BadgeMask
      variant="top-left"
      outlined
      outlineClassName={`${categoryClasses.text} opacity-30`}
    >
      <button
        type="button"
        onMouseDown={onCategoryClick}
        {...badgeHoverProps}
        className={`font-bold text-[10px] px-2 py-0.5 block rounded-full transition-[background-color,opacity] opacity-70 hover:opacity-100 active:scale-95 ${categoryClasses.bg} ${categoryClasses.text}`}
      >
        {translateCategory(primaryCategory, t)}
      </button>
    </BadgeMask>
  );
}

interface FollowOrganizationButtonProps {
  organizationId: number;
  profileCompleted: boolean;
  isSaved: boolean;
  categoryClasses: CategoryClasses;
  onToggleSave: (organizationId: number) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function FollowOrganizationButton({
  organizationId,
  profileCompleted,
  isSaved,
  categoryClasses,
  onToggleSave,
  t,
}: FollowOrganizationButtonProps) {
  return (
    <button
      type="button"
      disabled={!profileCompleted}
      onMouseDown={(event) => {
        event.stopPropagation();
        if (profileCompleted) {
          onToggleSave(organizationId);
        }
      }}
      aria-label={isSaved ? t("organizations.saved") : t("organizations.save")}
      className={`flex min-h-10 w-full items-center justify-center px-2 transition-colors ${
        !profileCompleted
          ? `pointer-events-none cursor-not-allowed bg-transparent ${categoryClasses.text} opacity-45 hover:bg-transparent hover:opacity-45`
          : isSaved
            ? `bg-transparent ${categoryClasses.text} hover:bg-background/40`
            : `bg-transparent ${categoryClasses.text} opacity-75 hover:bg-background/40 hover:opacity-100`
      }`}
    >
      <Bookmark
        className={`size-4 shrink-0 ${isSaved ? "fill-current" : ""}`}
        fill={isSaved ? "currentColor" : "none"}
      />
    </button>
  );
}

interface OrganizationFooterActionsProps {
  organization: Organization;
  followButton: React.ReactNode;
  profileCompleted: boolean;
  categoryClasses: CategoryClasses;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function OrganizationFooterActions({
  organization,
  followButton,
  profileCompleted,
  categoryClasses,
  t,
}: OrganizationFooterActionsProps) {
  const organizationPageHref = sanitizeHref(organization.organization_page);
  const hasOverflowLinks = Boolean(organization.ig || (organization.discord && sanitizeHref(organization.discord)));

  return (
    <div
      data-organization-card-footer
      onMouseDown={(event) => event.stopPropagation()}
      className={`grid grid-cols-3 border-t ${categoryClasses.border}`}
    >
      {profileCompleted ? (
        followButton
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="block min-h-10 w-full cursor-not-allowed"
              onMouseDown={(event) => event.stopPropagation()}
            >
              {followButton}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t("events.signIn")}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {organizationPageHref ? (
        <a
          href={organizationPageHref}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          aria-label={t("organizations.viewClubPage")}
          className={`flex min-h-10 items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
        >
          <ExternalLink className="size-4" />
        </a>
      ) : (
        <span
          aria-hidden="true"
          className={`flex min-h-10 items-center justify-center border-l px-2 opacity-35 ${categoryClasses.border} ${categoryClasses.text}`}
        >
          <ExternalLink className="size-4" />
        </span>
      )}

      <OrganizationOverflowMenu organization={organization} stopPropagation>
        <button
          type="button"
          onMouseDown={(event) => event.stopPropagation()}
          aria-label={t("common.moreOptions")}
          title={t("common.moreOptions")}
          disabled={!hasOverflowLinks}
          className={`flex min-h-10 w-full items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent ${categoryClasses.border} ${categoryClasses.text}`}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </OrganizationOverflowMenu>
    </div>
  );
}

function OrganizationCardComponent({
  organization,
  isSaved = false,
  onOrganizationClick,
  onCategoryClick,
}: OrganizationCardProps) {
  const { t } = useTranslation();
  const profileCompleted = useProfileCompleted();
  const toggleSaveOrganization = useSavedOrganizationsStore((state) => state.toggleSaveOrganization);
  const [isHoveringBadge, setIsHoveringBadge] = useState(false);

  const primaryCategory = useMemo(
    () => getOrganizationPrimaryCategory(organization),
    [organization],
  );
  const categoryClasses = useMemo(
    () => getCategoryClasses(primaryCategory),
    [primaryCategory],
  );
  const lastPostedLine = useMemo(
    () => formatOrganizationLastPosted(organization, t),
    [organization, t],
  );
  const eventCountBadges = useMemo(
    () => getOrganizationEventCountBadge(organization, t),
    [organization, t],
  );
  const socialHandle = useMemo(
    () => getOrganizationSocialHandle(organization),
    [organization],
  );

  const badgeHoverProps = useMemo(
    () => ({
      onMouseEnter: () => setIsHoveringBadge(true),
      onMouseLeave: () => setIsHoveringBadge(false),
    }),
    [],
  );

  const handleCategoryClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      if (primaryCategory) {
        onCategoryClick?.(primaryCategory);
      }
    },
    [onCategoryClick, primaryCategory],
  );

  const handleCardActivate = useCallback(() => {
    onOrganizationClick?.(organization);
  }, [onOrganizationClick, organization]);

  const handleCardMouseDown = useCardMouseDownActivate(
    handleCardActivate,
    "[data-organization-card-footer]",
  );

  const followButton = (
    <FollowOrganizationButton
      organizationId={organization.id}
      profileCompleted={profileCompleted}
      isSaved={isSaved}
      categoryClasses={categoryClasses}
      onToggleSave={toggleSaveOrganization}
      t={t}
    />
  );

  return (
    <article
      data-organization-card
      data-organization-id={organization.id}
      role="button"
      tabIndex={0}
      aria-label={`Organization: ${organization.organization_name}`}
      onMouseDown={handleCardMouseDown}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleCardActivate();
        }
      }}
      className={`event-card-waterpaint relative flex flex-col h-full rounded-xl overflow-hidden cursor-pointer transition-all duration-300 group border-x border-b ${categoryClasses.bg} ${categoryClasses.text} ${categoryClasses.border} ${
        isHoveringBadge ? "" : "hover:opacity-90 hover:shadow-lg"
      }`}
      style={getEventCardWaterpaintStyle(organization.id)}
    >
      <OrganizationCategoryBadge
        primaryCategory={primaryCategory}
        categoryClasses={categoryClasses}
        badgeHoverProps={badgeHoverProps}
        onCategoryClick={handleCategoryClick}
        t={t}
      />

      <EventCardContent
        title={organization.organization_name}
        date={lastPostedLine}
        location={socialHandle}
        badges={eventCountBadges}
        className="pt-8 sm:pt-9"
        textClassName={categoryClasses.text}
        secondaryTextClassName={categoryClasses.text}
        badgeClassName={`border-current ${categoryClasses.text}`}
      />

      <OrganizationFooterActions
        organization={organization}
        followButton={followButton}
        profileCompleted={profileCompleted}
        categoryClasses={categoryClasses}
        t={t}
      />
    </article>
  );
}

export const OrganizationCard = memo(OrganizationCardComponent);
OrganizationCard.displayName = "OrganizationCard";
