import { useTranslation } from "react-i18next";
import { clubPagePath } from "@/shared/constants/routes";
import { ClubTypeIcon } from "@/shared/components/ClubTypeIcon";
import { Badge } from "@/shared/ui/badge";
import { Link } from "@/shared/ui/link";
import { TruncatedText } from "@/shared/ui/truncated-text";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import type { ApiEventSummaryResponse } from "@/shared/generated";

const CLUB_NAME_CLASS = "max-w-56 flex-1 font-bold";
const CLUB_BADGE_CLASS = "tracking-normal flex min-w-0 max-w-full items-center gap-1";

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
  /** Host club; the badge opens its page. Absent for previews with no real club. */
  clubId?: number | null;
  cohosts?: ApiEventSummaryResponse["cohosts"];
  clubLogoUrl?: string | null;
  clubType?: string | null;
  school?: string | null;
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
    {cohosts.length > 0 ? <span data-slot="club-cohost-count" className="shrink-0 font-bold">+{cohosts.length}</span> : null}
    <ClubTypeIcon school={school} clubType={clubType} />
  </>;

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
      className={`${CLUB_BADGE_CLASS} transition-[background-color,transform] hover:bg-surface-hover active:scale-95`}
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
