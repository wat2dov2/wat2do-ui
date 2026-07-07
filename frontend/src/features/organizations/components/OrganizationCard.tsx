import { memo, useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  MoreHorizontal,
  Instagram,
} from "@/shared/ui/doodle-icons";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { getCategoryClasses, translateCategory } from "@/shared/utils/event";
import { sanitizeHref } from "@/shared/utils/url";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { useProfileCompleted } from "@/features/auth";
import { Badge } from "@/shared/ui/badge";
import { useCardMouseDownActivate, useMobileGridClickActivation, createAdaptivePressHandlers } from "@/shared/hooks";
import { OrganizationOverflowMenu } from "@/features/organizations/components/OrganizationOverflowMenu";
import {
  formatOrganizationLastPosted,
  getOrganizationEventCountBadge,
  getOrganizationSocialHandle,
} from "@/features/organizations/utils/organizationCardContent";
import { useOrganizationCardFrame } from "@/features/organizations/hooks/useOrganizationCardFrame";
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

interface FollowOrganizationButtonProps {
  organizationId: number;
  profileCompleted: boolean;
  isSaved: boolean;
  categoryClasses: CategoryClasses;
  preferClickPress: boolean;
  onToggleSave: (organizationId: number) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function FollowOrganizationButton({
  organizationId,
  profileCompleted,
  isSaved,
  categoryClasses,
  preferClickPress,
  onToggleSave,
  t,
}: FollowOrganizationButtonProps) {
  const pressHandlers = createAdaptivePressHandlers({
    preferClick: preferClickPress,
    disabled: !profileCompleted,
    onClick: () => {
      if (profileCompleted) {
        onToggleSave(organizationId);
      }
    },
  });

  return (
    <button
      type="button"
      disabled={!profileCompleted}
      {...pressHandlers}
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
  preferClickPress: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function OrganizationFooterActions({
  organization,
  followButton,
  profileCompleted,
  categoryClasses,
  preferClickPress,
  t,
}: OrganizationFooterActionsProps) {
  const instagramHref = organization.ig ? `https://instagram.com/${organization.ig}` : null;
  const hasOverflowLinks = Boolean(organization.organization_page || (organization.discord && sanitizeHref(organization.discord)));

  return (
    <div
      data-organization-card-footer
      onMouseDown={preferClickPress ? undefined : (event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className={`grid grid-cols-3 border-t ${categoryClasses.border}`}
    >
      {profileCompleted ? (
        followButton
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="block min-h-10 w-full cursor-not-allowed"
              onClick={(event) => event.stopPropagation()}
            >
              {followButton}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t("events.signIn")}</p>
          </TooltipContent>
        </Tooltip>
      )}

      {instagramHref ? (
        <a
          href={instagramHref}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={preferClickPress ? undefined : (event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          aria-label={t("organizations.instagram")}
          className={`flex min-h-10 items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
        >
          <Instagram className="size-4" />
        </a>
      ) : (
        <span
          aria-hidden="true"
          className={`flex min-h-10 items-center justify-center border-l px-2 opacity-35 ${categoryClasses.border} ${categoryClasses.text}`}
        >
          <Instagram className="size-4" />
        </span>
      )}

      <OrganizationOverflowMenu organization={organization} stopPropagation>
        <button
          type="button"
          aria-label={t("common.moreOptions")}
          title={t("common.moreOptions")}
          disabled={!hasOverflowLinks}
          className={`flex min-h-10 w-full items-center justify-center border-l px-2 opacity-75 transition-colors hover:bg-background/40 hover:opacity-100 ${categoryClasses.border} ${categoryClasses.text}`}
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

  const { cardRef, badgeRef, paths } = useOrganizationCardFrame();

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

  const preferClickPress = useMobileGridClickActivation();

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

  const runMouseDownActivate = useCardMouseDownActivate(
    handleCardActivate,
    "[data-organization-card-footer]",
  );

  const handleCardMouseDown = useCallback(
    (mouseEvent: React.MouseEvent<HTMLElement>) => {
      if (preferClickPress) {
        return;
      }
      runMouseDownActivate(mouseEvent);
    },
    [preferClickPress, runMouseDownActivate],
  );

  const handleCardClick = useCallback(
    (mouseEvent: React.MouseEvent<HTMLElement>) => {
      if (preferClickPress) {
        if (mouseEvent.button !== 0) return;
        if (!(mouseEvent.target instanceof Element)) return;
        if (mouseEvent.target.closest("button, a, [role='menuitem'], input, textarea, select, [data-no-card-activate], [data-organization-card-footer]")) return;
        handleCardActivate();
        return;
      }
      mouseEvent.preventDefault();
    },
    [handleCardActivate, preferClickPress],
  );

  const followButton = (
    <FollowOrganizationButton
      organizationId={organization.id}
      profileCompleted={profileCompleted}
      isSaved={isSaved}
      categoryClasses={categoryClasses}
      preferClickPress={preferClickPress}
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
      onClick={handleCardClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleCardActivate();
        }
      }}
      className={`relative flex flex-col h-full rounded-xl cursor-pointer transition-all duration-300 group ${categoryClasses.text} ${
        isHoveringBadge ? "" : "hover:opacity-90 hover:shadow-lg"
      }`}
      ref={cardRef}
    >
      {/* 1. Custom Background with clip-path (including -webkit support for Safari compatibility) */}
      <div
        className={`absolute inset-0 rounded-xl ${categoryClasses.bg}`}
        style={{
          clipPath: paths.clip ? `path('${paths.clip}')` : undefined,
          WebkitClipPath: paths.clip ? `path('${paths.clip}')` : undefined,
        }}
      />

      {/* 2. Custom Border SVG overlay (matching divider color at 25% opacity) */}
      {paths.border && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
          <path
            d={paths.border}
            fill="none"
            stroke="currentColor"
            style={{ stroke: "currentColor", opacity: 0.25 }}
            className={categoryClasses.text}
            strokeWidth={1}
          />
        </svg>
      )}

      {/* 3. The Badge (rendered outside the clipped background, matching Event Card badge style) */}
      {primaryCategory && (
        <div ref={badgeRef} className="absolute top-0 left-0 z-30">
          <Badge
            asChild
            variant="outline"
            size="lg"
            className={`block border-0 transition-[background-color,opacity] opacity-70 hover:opacity-100 active:scale-95 cursor-pointer ${categoryClasses.bg} ${categoryClasses.text}`}
          >
            <button
              type="button"
              onMouseDown={handleCategoryClick}
              {...badgeHoverProps}
            >
              {translateCategory(primaryCategory, t)}
            </button>
          </Badge>
        </div>
      )}

      {/* 4. Card Content (rendered on top of background) */}
      <div className="relative z-10 flex flex-col flex-1">
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
          preferClickPress={preferClickPress}
          t={t}
        />
      </div>
    </article>
  );
}

export const OrganizationCard = memo(OrganizationCardComponent);
OrganizationCard.displayName = "OrganizationCard";
