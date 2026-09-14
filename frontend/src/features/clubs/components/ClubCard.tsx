import { memo, useMemo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { Bookmark, Instagram } from "@/shared/ui/doodle-icons";
import { EventCardContent } from "@/shared/ui/event-card-content";
import { sanitizeHref } from "@/shared/utils/url";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { useProfileCompleted } from "@/features/auth/hooks/useAuthState";
import { ClubCategoryBadge } from "@/shared/components/ClubCategoryBadge";
import {
  useCardMouseDownActivate,
  useMobileGridClickActivation,
  createAdaptivePressHandlers,
} from "@/shared/hooks";
import { ClubOverflowMenu } from "@/features/clubs/components/ClubOverflowMenu";
import {
  getClubCountBadges,
  getClubSocialHandle,
} from "@/features/clubs/utils/clubCardContent";
import { useClubCardFrame } from "@/features/clubs/hooks/useClubCardFrame";
import type { Club } from "@/shared/types";
import { toast } from "@/shared/hooks/use-toast";
import { clubPagePath, ROUTES } from "@/shared/constants/routes";

interface ClubCardProps {
  club: Club;
  isSaved?: boolean;
  onClubClick?: (club: Club) => void;
  onCategoryClick?: (category: string) => void;
}

function getClubPrimaryCategory(club: Club): string {
  return club.categories[0] ?? "";
}

interface FollowClubButtonProps {
  clubId: number;
  profileCompleted: boolean;
  isSaved: boolean;
  preferClickPress: boolean;
  onToggleSave: (clubId: number) => void;
  onLoginRequired: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function FollowClubButton({
  clubId,
  profileCompleted,
  isSaved,
  preferClickPress,
  onToggleSave,
  onLoginRequired,
  t,
}: FollowClubButtonProps) {
  const pressHandlers = createAdaptivePressHandlers({
    preferClick: preferClickPress,
    onClick: () => {
      if (profileCompleted) {
        onToggleSave(clubId);
      } else {
        onLoginRequired();
      }
    },
  });

  return (
    <button
      type="button"
      {...pressHandlers}
      aria-label={isSaved ? t("clubs.saved") : t("clubs.save")}
      className="flex min-h-12 w-full items-center justify-center rounded-bl-xl bg-transparent px-2 text-muted-foreground transition-colors hover:bg-surface-hover"
    >
      <Bookmark
        className={`size-5 shrink-0 ${isSaved ? "fill-current" : ""}`}
        fill={isSaved ? "currentColor" : "none"}
      />
    </button>
  );
}

interface ClubFooterActionsProps {
  club: Club;
  followButton: React.ReactNode;
  preferClickPress: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function ClubFooterActions({
  club,
  followButton,
  preferClickPress,
  t,
}: ClubFooterActionsProps) {
  const instagramHref = sanitizeHref(
    club.ig
      ? `https://instagram.com/${club.ig.replace(/^@/, "")}`
      : null,
  );
  return (
    <div
      data-club-card-footer
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
          aria-label={t("clubs.instagram")}
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

      <ClubOverflowMenu club={club} stopPropagation />
    </div>
  );
}

function ClubCardComponent({
  club,
  isSaved = false,
  onClubClick,
  onCategoryClick,
}: ClubCardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const profileCompleted = useProfileCompleted();
  const toggleSaveClub = useSavedClubsStore(
    (state) => state.toggleSaveClub,
  );
  const [isHoveringBadge, setIsHoveringBadge] = useState(false);

  const { cardRef, badgeRef, paths } = useClubCardFrame();

  const primaryCategory = useMemo(
    () => getClubPrimaryCategory(club),
    [club],
  );
  const countBadges = useMemo(
    () => getClubCountBadges(club, t),
    [club, t],
  );
  const socialHandle = useMemo(
    () => getClubSocialHandle(club),
    [club],
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
    onClubClick?.(club);
  }, [onClubClick, club]);

  const runMouseDownActivate = useCardMouseDownActivate(
    handleCardActivate,
    "[data-club-card-footer]",
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
            "button, a, [role='menuitem'], input, textarea, select, [data-no-card-activate], [data-club-card-footer]",
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
    <FollowClubButton
      clubId={club.id}
      profileCompleted={profileCompleted}
      isSaved={isSaved}
      preferClickPress={preferClickPress}
      onToggleSave={toggleSaveClub}
      onLoginRequired={() =>
        toast({
          description: t("clubs.signInToFollow"),
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
      data-club-card
      data-club-id={club.id}
      role="button"
      tabIndex={0}
      aria-label={`Club: ${club.club_name}`}
      onMouseDown={handleCardMouseDown}
      onClick={handleCardClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleCardActivate();
        }
      }}
      className={`relative isolate flex flex-col h-full rounded-xl cursor-pointer transition-all duration-300 group text-foreground ${
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
          <ClubCategoryBadge type={primaryCategory}>
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
          </ClubCategoryBadge>
        </div>
      )}

      {/* 4. Card Content (rendered on top of background) */}
      <div className="relative z-10 flex flex-col flex-1">
        <EventCardContent
          title={club.club_name}
          titleHref={clubPagePath(club.id)}
          location={socialHandle}
          badges={countBadges}
          horizontalPadding="inset"
          className="pt-8 sm:pt-9"
          textClassName="text-foreground"
          secondaryTextClassName="text-muted-foreground"
          badgeClassName="border-border text-muted-foreground"
        />

        <ClubFooterActions
          club={club}
          followButton={followButton}
          preferClickPress={preferClickPress}
          t={t}
        />
      </div>
    </article>
  );
}

export const ClubCard = memo(ClubCardComponent);
ClubCard.displayName = "ClubCard";
