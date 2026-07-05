import { memo, useMemo, useCallback, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Bookmark,
  ExternalLink,
  MoreHorizontal,
} from "@/shared/ui/doodle-icons";
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

  const cardRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: 0, h: 0, cw: 0, ch: 0 });

  useEffect(() => {
    const cardEl = cardRef.current;
    const badgeEl = badgeRef.current;
    if (!cardEl) return;

    const updateDimensions = () => {
      setDimensions({
        w: cardEl.offsetWidth,
        h: cardEl.offsetHeight,
        cw: badgeEl ? badgeEl.offsetWidth : 0,
        ch: badgeEl ? badgeEl.offsetHeight : 0,
      });
    };

    updateDimensions();

    const observer = new ResizeObserver(() => {
      updateDimensions();
    });

    observer.observe(cardEl);
    if (badgeEl) observer.observe(badgeEl);

    return () => {
      observer.disconnect();
    };
  }, []);

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

  const paths = useMemo(() => {
    const { w, h, cw, ch } = dimensions;
    if (w === 0 || h === 0) return { border: "", clip: "" };

    const R = 12; // Card corner radius
    const r = 8;  // Cutout transition radius
    const gap = 4; // Space around badge

    // Cutout dimensions including the gap
    const cw_c = cw > 0 ? cw + gap : 0;
    const ch_c = ch > 0 ? ch + gap : 0;

    // Standard rounded rect path if no badge
    if (cw_c === 0 || ch_c === 0) {
      const standardPath = `M ${R} 0
        L ${w - R} 0
        A ${R} ${R} 0 0 1 ${w} ${R}
        L ${w} ${h - R}
        A ${R} ${R} 0 0 1 ${w - R} ${h}
        L ${R} ${h}
        A ${R} ${R} 0 0 1 0 ${h - R}
        L 0 ${R}
        A ${R} ${R} 0 0 1 ${R} 0 Z`;
      return { border: standardPath, clip: standardPath };
    }

    const offset = 0.5;
    const w_b = w - offset;
    const h_b = h - offset;
    const cw_b = cw_c - offset;
    const ch_b = ch_c - offset;

    // Border path with 0.5px offset to avoid clipping card outlines
    const borderPath = `M ${cw_b + r} ${offset}
      L ${w_b - R} ${offset}
      A ${R} ${R} 0 0 1 ${w_b} ${R}
      L ${w_b} ${h_b - R}
      A ${R} ${R} 0 0 1 ${w_b - R} ${h_b}
      L ${R} ${h_b}
      A ${R} ${R} 0 0 1 ${offset} ${h_b - R}
      L ${offset} ${ch_b + r}
      A ${r} ${r} 0 0 1 ${r + offset} ${ch_b}
      L ${cw_b - r} ${ch_b}
      A ${r} ${r} 0 0 0 ${cw_b} ${ch_b - r}
      L ${cw_b} ${r + offset}
      A ${r} ${r} 0 0 1 ${cw_b + r} ${offset} Z`;

    // Clip path (running along the absolute outer edge)
    const clipPath = `M ${cw_c + r} 0
      L ${w - R} 0
      A ${R} ${R} 0 0 1 ${w} ${R}
      L ${w} ${h - R}
      A ${R} ${R} 0 0 1 ${w - R} ${h}
      L ${R} ${h}
      A ${R} ${R} 0 0 1 0 ${h - R}
      L 0 ${ch_c + r}
      A ${r} ${r} 0 0 1 ${r} ${ch_c}
      L ${cw_c - r} ${ch_c}
      A ${r} ${r} 0 0 0 ${cw_c} ${ch_c - r}
      L ${cw_c} ${r}
      A ${r} ${r} 0 0 1 ${cw_c + r} 0 Z`;

    return { border: borderPath, clip: clipPath };
  }, [dimensions]);

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

  // Invert the badge colors: light theme text background, dark theme bg text
  const badgeBgClass = categoryClasses.text.split(" ").find(c => c.startsWith("text-"))?.replace("text-", "bg-") || "bg-foreground";
  const badgeTextClass = categoryClasses.bg.split(" ").find(c => c.startsWith("bg-"))?.replace("bg-", "text-") || "text-background";

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
      className={`relative flex flex-col h-full rounded-xl cursor-pointer transition-all duration-300 group ${categoryClasses.text} ${
        isHoveringBadge ? "" : "hover:opacity-90 hover:shadow-lg"
      }`}
      ref={cardRef}
    >
      {/* 1. Custom Background with clip-path for the waterpaint gradients */}
      <div
        className={`event-card-waterpaint absolute inset-0 rounded-xl ${categoryClasses.bg}`}
        style={{
          clipPath: paths.clip ? `path('${paths.clip}')` : undefined,
          ...getEventCardWaterpaintStyle(organization.id),
        }}
      />

      {/* 2. Custom Border SVG overlay */}
      {paths.border && (
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
          <path
            d={paths.border}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            className={categoryClasses.border}
          />
        </svg>
      )}

      {/* 3. The Badge (rendered outside the clipped background, so it is fully visible) */}
      {primaryCategory && (
        <div ref={badgeRef} className="absolute top-0 left-0 z-30">
          <button
            type="button"
            onMouseDown={handleCategoryClick}
            {...badgeHoverProps}
            className={`font-bold text-[10px] px-2 py-0.5 block rounded-full transition-[background-color,opacity] opacity-90 hover:opacity-100 active:scale-95 border ${categoryClasses.border} ${badgeBgClass} ${badgeTextClass}`}
          >
            {translateCategory(primaryCategory, t)}
          </button>
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
          t={t}
        />
      </div>
    </article>
  );
}

export const OrganizationCard = memo(OrganizationCardComponent);
OrganizationCard.displayName = "OrganizationCard";
