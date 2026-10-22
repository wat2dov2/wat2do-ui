import { memo, useMemo, useCallback } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { Button } from "@/shared/ui/button";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { getClubCategoryConfig } from "@/shared/data/clubCategoryStyles";
import { translateCategory } from "@/shared/utils/event";
import {
  useCardMouseDownActivate,
  useMobileClickActivation,
} from "@/shared/hooks";
import {
  getClubCountBadges,
  getClubSocialHandle,
} from "@/features/clubs/utils/clubCardContent";
import type { Club } from "@/shared/types";
import { toast } from "@/shared/hooks/use-toast";
import { clubPagePath, ROUTES } from "@/shared/constants/routes";

/** Controls inside the card act on their own and never open the club. */
const CARD_ACTION_SELECTOR = "[data-club-card-action]";

interface ClubCardProps {
  club: Club;
  isSaved?: boolean;
  onClubClick?: (club: Club) => void;
  onCategoryClick?: (category: string) => void;
}

/** A followed club's outline carries a highlight that travels around it. */
function FollowedTrace() {
  // Inset by half the stroke so the outline sits exactly on the card's border.
  const outline = { x: 0, y: 0, width: "100%", height: "100%", rx: 15.25, fill: "none", stroke: "currentColor" } as const;
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-[0.75px] size-[calc(100%-1.5px)] overflow-visible text-badge-new">
      <rect {...outline} strokeOpacity={0.45} strokeWidth={1.5} />
      <rect
        {...outline}
        pathLength={100}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="18 82"
        className="animate-border-trace motion-reduce:animate-none"
      />
    </svg>
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
  const { isAuthenticated } = useAuthState();
  const toggleSaveClub = useSavedClubsStore((state) => state.toggleSaveClub);
  const preferClickPress = useMobileClickActivation();

  const category = club.categories[0] ?? "";
  const categoryColor = getClubCategoryConfig(category).color;
  const socialHandle = useMemo(() => getClubSocialHandle(club), [club]);
  // Many clubs are named by their handle; the handle line only adds something when it differs.
  const showHandle = socialHandle !== undefined && socialHandle !== club.club_name;
  const counts = useMemo(() => getClubCountBadges(club, t).map((badge) => badge.text), [club, t]);

  const handleCardActivate = useCallback(() => onClubClick?.(club), [onClubClick, club]);
  const runMouseDownActivate = useCardMouseDownActivate(handleCardActivate, CARD_ACTION_SELECTOR);

  const handleCardMouseDown = useCallback(
    (mouseEvent: React.MouseEvent<HTMLElement>) => {
      if (!preferClickPress) runMouseDownActivate(mouseEvent);
    },
    [preferClickPress, runMouseDownActivate],
  );

  const handleCardClick = useCallback(
    (mouseEvent: React.MouseEvent<HTMLElement>) => {
      if (preferClickPress) {
        runMouseDownActivate(mouseEvent);
        return;
      }
      if (mouseEvent.target instanceof Element && mouseEvent.target.closest("a")) return;
      mouseEvent.preventDefault();
    },
    [runMouseDownActivate, preferClickPress],
  );

  const toggleFollow = () => {
    if (isAuthenticated) {
      toggleSaveClub(club.id);
      return;
    }
    toast({
      description: t("clubs.signInToFollow"),
      action: { label: t("events.signIn"), onClick: () => router.push(ROUTES.LOGIN) },
    });
  };

  // Card controls keep their own presses: the card opens on mouse down, so they stop it there too.
  const stopCardActivation = {
    onMouseDown: preferClickPress ? undefined : (event: React.MouseEvent) => event.stopPropagation(),
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
  };

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
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleCardActivate();
        }
      }}
      className="group relative flex h-full cursor-pointer flex-col gap-4 rounded-2xl border border-border bg-surface p-4 text-foreground transition-[border-color,box-shadow] duration-200 hover:border-border-hover hover:shadow-[0_10px_30px_-18px_rgb(0_0_0/0.35)]"
    >
      {isSaved ? <FollowedTrace /> : null}

      <div className="flex items-start justify-between gap-3">
        <AvatarStack size="lg" avatars={[{ src: club.logo_url ?? "", name: club.club_name }]} />
        <div data-club-card-action {...stopCardActivation}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            selected={isSaved}
            onClick={toggleFollow}
            aria-label={isSaved ? t("clubs.saved") : t("clubs.save")}
          >
            {isSaved ? t("clubs.following") : t("clubs.follow")}
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="line-clamp-2 text-base leading-snug font-medium tracking-[-0.01em] text-balance">
          <NextLink href={clubPagePath(club.id)} className="outline-none">
            {club.club_name}
          </NextLink>
        </h3>
        {showHandle ? (
          <p data-slot="club-card-handle" className="truncate text-sm text-muted-foreground">
            {socialHandle}
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        {category ? (
          <button
            type="button"
            data-club-card-action
            {...stopCardActivation}
            onClick={(event) => {
              event.stopPropagation();
              onCategoryClick?.(category);
            }}
            className="flex min-w-0 shrink-0 cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor }} />
            {translateCategory(category, t)}
          </button>
        ) : null}
        {counts.map((count) => (
          <span key={count} className="whitespace-nowrap">{count}</span>
        ))}
      </div>
    </article>
  );
}

export const ClubCard = memo(ClubCardComponent);
ClubCard.displayName = "ClubCard";
