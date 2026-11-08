import { memo, useMemo, useCallback } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { Check, Plus } from "lucide-react";
import { IconSwap } from "@/shared/ui/icon-swap";
import { cn } from "@/shared/lib/utils";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { Button } from "@/shared/ui/button";
import { useSavedClubsStore } from "@/features/clubs/store/savedClubs.store";
import { useOpenClubPanel } from "@/features/clubs/hooks/useOpenClubPanel";
import { useAuthState } from "@/features/auth/hooks/useAuthState";
import { useSignedInAction } from "@/features/auth/hooks/useSignInGate";
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
import { clubPagePath } from "@/shared/constants/routes";

/** The card's layout, shared with its loading skeleton so both take the same boxes. */
export const CLUB_CARD_CLASSES = {
  card: "group relative flex h-full flex-col gap-4 rounded-2xl border border-border bg-surface p-4 text-foreground",
  top: "flex items-start justify-between gap-3",
  // Room for a two-line name and its handle (2 x 22px + 4px + 20px), so short names keep the card's height.
  name: "flex min-h-[4.25rem] min-w-0 flex-col gap-1",
  title: "line-clamp-2 text-base leading-snug font-medium tracking-[-0.01em] text-balance",
  handle: "truncate text-sm text-muted-foreground",
  // One line on every card: the category shortens before the counts, so a row never grows when
  // one club's counts run long and the loading grid can hold every card's exact height.
  meta: "mt-auto flex min-w-0 items-center gap-x-3 overflow-hidden text-sm text-muted-foreground",
};

/** Controls inside the card act on their own and never open the club. */
const CARD_ACTION_SELECTOR = "[data-club-card-action]";

interface ClubCardProps {
  club: Club;
  isSaved?: boolean;
  onClubClick?: (club: Club) => void;
  onCategoryClick?: (category: string) => void;
}

function ClubCardComponent({
  club,
  isSaved = false,
  onClubClick,
  onCategoryClick,
}: ClubCardProps) {
  const { t } = useTranslation();
  const { clubs } = useAuthState();
  const signedInAction = useSignedInAction();
  const managesClub = clubs.some((managedClub) => managedClub.id === club.id);
  const openClubPanel = useOpenClubPanel();
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

  const toggleFollow = () => signedInAction(() => toggleSaveClub(club.id));

  // Card controls keep their own presses: the card opens on mouse down, so they stop it there too.
  const stopCardActivation = {
    onMouseDown: preferClickPress ? undefined : (event: React.MouseEvent) => event.stopPropagation(),
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
  };

  return (
    <article
      data-club-card
      data-skeleton-key="card"
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
      className={cn(CLUB_CARD_CLASSES.card, "cursor-pointer transition-[border-color,box-shadow] duration-200 hover:border-border-hover hover:shadow-[0_10px_30px_-18px_rgb(0_0_0/0.35)]")}
    >

      <div className={CLUB_CARD_CLASSES.top} data-skeleton-key="card-top">
        <AvatarStack size="lg" avatars={[{ src: club.logo_url ?? "", name: club.club_name }]} />
        <div data-club-card-action {...stopCardActivation}>
          {managesClub ? (
            // Members always follow their club, so they see their role instead of a follow toggle.
            <Button type="button" variant="outline" size="sm" selected onClick={() => openClubPanel(club)}>
              {t("clubPanel.roleOwner")}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              selected={isSaved}
              selectionIndicator="none"
              onClick={toggleFollow}
              aria-label={isSaved ? t("clubs.saved") : t("clubs.save")}
            >
              <IconSwap showAlternate={isSaved} icon={<Plus />} alternate={<Check className={cn(isSaved && "animate-success-pulse")} />} />
              {isSaved ? t("clubs.following") : t("clubs.follow")}
            </Button>
          )}
        </div>
      </div>

      <div className={CLUB_CARD_CLASSES.name}>
        <h3 className={CLUB_CARD_CLASSES.title}>
          <NextLink href={clubPagePath(club.id)} className="outline-none">
            {club.club_name}
          </NextLink>
        </h3>
        {showHandle ? (
          <p data-slot="club-card-handle" className={CLUB_CARD_CLASSES.handle}>
            {socialHandle}
          </p>
        ) : null}
      </div>

      <div data-skeleton-key="card-meta" className={CLUB_CARD_CLASSES.meta}>
        {category ? (
          <button
            type="button"
            data-club-card-action
            {...stopCardActivation}
            onClick={(event) => {
              event.stopPropagation();
              onCategoryClick?.(category);
            }}
            className="flex min-w-0 cursor-pointer items-center gap-1.5 transition-colors hover:text-foreground"
          >
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: categoryColor }} />
            <span className="truncate">{translateCategory(category, t)}</span>
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
