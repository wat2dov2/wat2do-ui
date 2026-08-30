import { memo, useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Bookmark, Instagram } from "@/shared/ui/doodle-icons";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { sanitizeHref } from "@/shared/utils/url";
import { useSavedOrganizationsStore } from "@/features/organizations/store/savedOrganizations.store";
import { useProfileCompleted } from "@/features/auth/hooks/useAuthState";
import { OrganizationCategoryBadge } from "@/shared/components/OrganizationCategoryBadge";
import {
  useCardMouseDownActivate,
  useMobileGridClickActivation,
  createAdaptivePressHandlers,
} from "@/shared/hooks";
import { OrganizationOverflowMenu } from "@/features/organizations/components/OrganizationOverflowMenu";
import {
  getOrganizationCountBadges,
  getOrganizationSocialHandle,
} from "@/features/organizations/utils/organizationCardContent";
import { useOrganizationCardFrame } from "@/features/organizations/hooks/useOrganizationCardFrame";
import type { Organization } from "@/shared/types";
import { toast } from "@/shared/hooks/use-toast";
import { organizationPagePath, ROUTES } from "@/shared/constants/routes";

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
  onLoginRequired: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function FollowOrganizationButton({
  organizationId,
  profileCompleted,
  isSaved,
  preferClickPress,
  onToggleSave,
  onLoginRequired,
  t,
}: FollowOrganizationButtonProps) {
  const pressHandlers = createAdaptivePressHandlers({
    preferClick: preferClickPress,
    onClick: () => {
      if (profileCompleted) {
        onToggleSave(organizationId);
      } else {
        onLoginRequired();
      }
    },
  });

  return (
    <button
      type="button"
      {...pressHandlers}
      aria-label={isSaved ? t("organizations.saved") : t("organizations.save")}
      className="flex min-h-12 w-full items-center justify-center rounded-bl-xl bg-transparent px-2 text-muted-foreground transition-colors hover:bg-surface-hover"
    >
      <Bookmark
        className={`size-5 shrink-0 ${isSaved ? "fill-current" : ""}`}
        fill={isSaved ? "currentColor" : "none"}
      />
    </button>
  );
}

interface OrganizationFooterActionsProps {
  organization: Organization;
  followButton: React.ReactNode;
  preferClickPress: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function OrganizationFooterActions({
  organization,
  followButton,
  preferClickPress,
  t,
}: OrganizationFooterActionsProps) {
  const instagramHref = sanitizeHref(
    organization.ig
      ? `https://instagram.com/${organization.ig.replace(/^@/, "")}`
      : null,
  );
  return (
    <div
      data-organization-card-footer
      onMouseDown={
        preferClickPress ? undefined : (event) => event.stopPropagation()
      }
      onClick={(event) => event.stopPropagation()}
      className={`grid grid-cols-3 border-t border-border`}
    >
      {followButton}

      {instagramHref ? (
        <a
          href={instagramHref}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={
            preferClickPress ? undefined : (event) => event.stopPropagation()
          }
          onClick={(event) => event.stopPropagation()}
          aria-label={t("organizations.instagram")}
          className="flex min-h-12 items-center justify-center border-l border-border px-2 text-muted-foreground transition-colors hover:bg-surface-hover"
        >
          <Instagram className="size-5" />
        </a>
      ) : (
        <span
          aria-hidden="true"
          className="flex min-h-12 items-center justify-center border-l border-border px-2 text-muted-foreground opacity-35"
        >
          <Instagram className="size-5" />
        </span>
      )}

      <OrganizationOverflowMenu organization={organization} stopPropagation />
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
  const router = useRouter();
  const profileCompleted = useProfileCompleted();
  const toggleSaveOrganization = useSavedOrganizationsStore(
    (state) => state.toggleSaveOrganization,
  );
  const [isHoveringBadge, setIsHoveringBadge] = useState(false);

  const { cardRef, badgeRef, paths } = useOrganizationCardFrame();

  const primaryCategory = useMemo(
    () => getOrganizationPrimaryCategory(organization),
    [organization],
  );
  const countBadges = useMemo(
    () => getOrganizationCountBadges(organization, t),
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
        if (
          mouseEvent.target.closest(
            "button, a, [role='menuitem'], input, textarea, select, [data-no-card-activate], [data-organization-card-footer]",
          )
        )
          return;
        handleCardActivate();
        return;
      }
      if (
        mouseEvent.target instanceof Element &&
        mouseEvent.target.closest("a")
      ) {
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
      onLoginRequired={() =>
        toast({
          description: t("organizations.signInToFollow"),
          action: {
            label: t("events.signIn"),
            onClick: () => router.push(ROUTES.LOGIN),
          },
        })
      }
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
          titleHref={organizationPagePath(organization.id)}
          location={socialHandle}
          badges={countBadges}
          horizontalPadding="inset"
          className="pt-8 sm:pt-9"
          textClassName="text-foreground"
          secondaryTextClassName="text-muted-foreground"
          badgeClassName="border-border text-muted-foreground"
        />

        <OrganizationFooterActions
          organization={organization}
          followButton={followButton}
          preferClickPress={preferClickPress}
          t={t}
        />
      </div>
    </article>
  );
}

export const OrganizationCard = memo(OrganizationCardComponent);
OrganizationCard.displayName = "OrganizationCard";
