import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { clubPagePath } from "@/shared/constants/routes";
import { ClubTypeIcon } from "@/shared/components/ClubTypeIcon";
import { ClubVerifiedCheck } from "@/features/clubs/components/ClubVerifiedCheck";
import { Badge } from "@/shared/ui/badge";
import { Link } from "@/shared/ui/link";
import { TruncatedText } from "@/shared/ui/truncated-text";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { clubBadgeMenuClubs, type ClubBadgeMenuClub } from "@/features/clubs/lib/clubBadgeMenu";
import type { ApiEventSummaryResponse } from "@/shared/generated";

const CLUB_NAME_CLASS = "max-w-56 flex-1 font-bold";
const CLUB_BADGE_CLASS = "tracking-normal flex min-w-0 max-w-full items-center gap-1";
// Pressed like a Button: it eases down to 0.97 (scale-* sets the scale property, so that is what transitions).
const PRESSABLE_CLUB_BADGE_CLASS = `${CLUB_BADGE_CLASS} cursor-pointer transition-[background-color,scale] hover:bg-surface-hover active:scale-[0.97]`;

/** The host badge before its event loads: the logo and a name-length line. */
export function ClubBadgeSkeleton() {
  return (
    <Badge asChild variant="plain" size="inline" className={CLUB_BADGE_CLASS} aria-hidden="true">
      <span data-slot="club-badge">
        <Skeleton className="size-5 shrink-0 rounded-full" />
        <SkeletonLine className="w-32" />
      </span>
    </Badge>
  );
}

interface ClubBadgeLinkProps {
  clubName: string;
  /**
   * Host club; the badge opens its page, or with cohosts a menu of every club's page.
   * Absent for previews with no real club.
   */
  clubId?: number | null;
  cohosts?: ApiEventSummaryResponse["cohosts"];
  clubLogoUrl?: string | null;
  clubType?: string | null;
  school?: string | null;
  /** The club has claimed its page and runs this event itself: a check follows its name. */
  verified?: boolean;
  disabled?: boolean;
  /** Eager on the first screen, so the logos arrive with the page instead of after it. */
  logoLoading?: "eager" | "lazy";
  /** Lets an open modal or drawer close as the club page opens. */
  onNavigate?: () => void;
  onMouseDown?: React.MouseEventHandler;
  onClick?: React.MouseEventHandler;
}

export function ClubBadgeLink({
  clubName,
  clubId,
  cohosts = [],
  clubLogoUrl,
  clubType,
  school,
  verified = false,
  disabled = false,
  logoLoading,
  onNavigate,
  onMouseDown,
  onClick,
}: ClubBadgeLinkProps) {
  const { t } = useTranslation();

  const avatars = [
    { name: clubName, src: clubLogoUrl ?? "" },
    ...cohosts.map((club) => ({ name: club.club_name, src: club.logo_url ?? "" })),
  ];
  const content = <>
    <AvatarStack size="sm" avatars={avatars} loading={logoLoading} />
    <TruncatedText text={clubName || t("events.club")} className={CLUB_NAME_CLASS} />
    {verified ? <ClubVerifiedCheck clubName={clubName} /> : null}
    {cohosts.length > 0 ? <span data-slot="club-cohost-count" className="shrink-0 font-bold">+{cohosts.length}</span> : null}
    <ClubTypeIcon school={school} clubType={clubType} />
  </>;

  const menuClubs = disabled ? [] : clubBadgeMenuClubs({ id: clubId, name: clubName, logoUrl: clubLogoUrl }, cohosts);
  if (menuClubs.length > 0) {
    return (
      <ClubBadgeMenu
        clubs={menuClubs}
        label={t("clubs.badgeMenuLabel", { club: clubName })}
        onNavigate={onNavigate}
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        {content}
      </ClubBadgeMenu>
    );
  }

  if (disabled || !clubName || !clubId) {
    return (
      <Badge
        asChild
        variant="plain"
        size="inline"
        className={CLUB_BADGE_CLASS}
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <span data-slot="club-badge">
          {content}
        </span>
      </Badge>
    );
  }

  return (
    <Badge
      asChild
      variant="plain"
      size="inline"
      className={PRESSABLE_CLUB_BADGE_CLASS}
    >
      <Link
        variant="navigation"
        href={clubPagePath(clubId)}
        prefetch={false}
        data-slot="club-badge"
        onMouseDown={onMouseDown}
        onClick={(event) => {
          onClick?.(event);
          onNavigate?.();
        }}
      >
        {content}
      </Link>
    </Badge>
  );
}

interface ClubBadgeMenuProps {
  clubs: ClubBadgeMenuClub[];
  label: string;
  children: ReactNode;
  onNavigate?: () => void;
  onMouseDown?: React.MouseEventHandler;
  onClick?: React.MouseEventHandler;
}

/**
 * A badge for several clubs: pressing it lists each club, and picking one opens
 * that club's page, as a single club's badge does. The press stops at the badge
 * and its menu, so the card around it does not open too.
 */
function ClubBadgeMenu({ clubs, label, children, onNavigate, onMouseDown, onClick }: ClubBadgeMenuProps) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onMouseDown={onMouseDown} onClick={onClick}>
        <Badge asChild variant="plain" size="inline" className={PRESSABLE_CLUB_BADGE_CLASS}>
          <button type="button" data-slot="club-badge" aria-label={label}>
            {children}
          </button>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-72" stopPropagation>
        {clubs.map((club) => (
          <DropdownMenuItem
            key={club.id}
            data-slot="club-badge-menu-item"
            onSelect={() => {
              onNavigate?.();
              router.push(clubPagePath(club.id));
            }}
          >
            <AvatarStack size="sm" decorative avatars={[{ name: club.name, src: club.logoUrl }]} />
            <span className="min-w-0 truncate">{club.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
