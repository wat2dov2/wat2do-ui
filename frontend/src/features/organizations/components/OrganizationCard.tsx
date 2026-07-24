import { memo, useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  MoreHorizontal,
  Instagram,
} from "@/shared/ui/doodle-icons";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { sanitizeHref } from "@/shared/utils/url";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { useProfileCompleted } from "@/features/auth";
import { OrganizationCategoryBadge } from "@/shared/components/OrganizationCategoryBadge";
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

function getOrganizationPrimaryCategory(organization: Organization): string {
  return organization.categories[0] ?? "";
}

interface FollowOrganizationButtonProps {
  organizationId: number;
  profileCompleted: boolean;
  isSaved: boolean;
  preferClickPress: boolean;
  onToggleSave: (organizationId: number) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function FollowOrganizationButton({
  organizationId,
  profileCompleted,
  isSaved,
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
      className={`flex min-h-10 w-full items-center justify-center rounded-bl-xl px-2 transition-colors ${
        !profileCompleted
          ? `pointer-events-none cursor-not-allowed bg-transparent text-muted-foreground opacity-45`
          : `bg-transparent text-muted-foreground hover:bg-surface-hover`
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
  preferClickPress: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function OrganizationFooterActions({
  organization,
  followButton,
  profileCompleted,
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
      className={`grid grid-cols-3 border-t border-border`}
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
          className={`flex min-h-10 items-center justify-center border-l px-2 transition-colors hover:bg-surface-hover border-border text-muted-foreground`}
        >
          <Instagram className="size-4" />
        </a>
      ) : (
        <span
          aria-hidden="true"
          className={`flex min-h-10 items-center justify-center border-l px-2 opacity-35 border-border text-muted-foreground`}
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
          className={`flex min-h-10 w-full items-center justify-center rounded-br-xl border-l px-2 transition-colors hover:bg-surface-hover border-border text-muted-foreground`}
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
      className={`relative flex flex-col h-full rounded-xl cursor-pointer transition-all duration-300 group text-foreground ${
        isHoveringBadge ? "" : "hover:opacity-90 hover:shadow-lg"
      }`}
      ref={cardRef}
    >
      {/* 1. Custom Background with clip-path (including -webkit support for Safari compatibility) */}
      <div
        className="absolute inset-0 rounded-xl bg-surface"
        style={{
          clipPath: paths.clip ? `path('${paths.clip}')` : undefined,
          WebkitClipPath: paths.clip ? `path('${paths.clip}')` : undefined,
        }}
      />

      {/* 2. Custom Border SVG overlay */}
      {paths.borderOuter && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
          <path
            d={paths.borderOuter}
            fill="none"
            stroke="currentColor"
            style={{ stroke: "currentColor", opacity: 0.25 }}
            className="text-muted-foreground"
            strokeWidth={1}
          />
        </svg>
      )}
      {paths.borderCutout && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-40">
          <path
            d={paths.borderCutout}
            fill="none"
            stroke="currentColor"
            style={{ stroke: "currentColor", opacity: 0.38 }}
            className="text-muted-foreground"
            strokeWidth={1}
          />
        </svg>
      )}

      {/* 3. The Badge (rendered outside the clipped background, matching Event Card badge style) */}
      {primaryCategory && (
        <div ref={badgeRef} className="absolute top-0 left-0 z-30">
          <OrganizationCategoryBadge type={primaryCategory}>
            {(content) => (
              <button
                type="button"
                onMouseDown={handleCategoryClick}
                className="flex cursor-pointer active:scale-95"
                {...badgeHoverProps}
              >
                {content}
              </button>
            )}
          </OrganizationCategoryBadge>
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
          textClassName="text-foreground"
          secondaryTextClassName="text-muted-foreground"
          badgeClassName="border-border text-muted-foreground"
        />

        <OrganizationFooterActions
          organization={organization}
          followButton={followButton}
          profileCompleted={profileCompleted}
            preferClickPress={preferClickPress}
          t={t}
        />
      </div>
    </article>
  );
}

export const OrganizationCard = memo(OrganizationCardComponent);
OrganizationCard.displayName = "OrganizationCard";
