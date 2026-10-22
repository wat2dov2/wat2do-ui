import { useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { clubPagePath } from "@/shared/constants/routes";
import { ClubTypeIcon } from "@/shared/components/ClubTypeIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Badge } from "@/shared/ui/badge";
import { TruncatedText } from "@/shared/ui/truncated-text";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import type { ApiEventSummaryResponse } from "@/shared/generated";

const CLUB_NAME_CLASS = "max-w-56 flex-1 font-bold";

interface ClubBadgeDropdownProps {
  /** The hosting club's Wat2Do page; absent only on decorative, disabled badges. */
  clubId?: number | null;
  clubName: string;
  cohosts?: ApiEventSummaryResponse["cohosts"];
  clubLogoUrl?: string | null;
  clubType?: string | null;
  school?: string | null;
  disabled?: boolean;
  /** Runs when a profile link is chosen, e.g. to close the drawer it sits in. */
  onNavigate?: () => void;
  onMouseDown?: React.MouseEventHandler;
  onClick?: React.MouseEventHandler;
}

export function ClubBadgeDropdown({
  clubId,
  clubName,
  cohosts = [],
  clubLogoUrl,
  clubType,
  school,
  disabled = false,
  onNavigate,
  onMouseDown,
  onClick,
}: ClubBadgeDropdownProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const clubs = [{ id: clubId, club_name: clubName, logo_url: clubLogoUrl }, ...cohosts];
  const content = <>
    <AvatarStack size="sm" avatars={clubs.map(club => ({ name: club.club_name, src: club.logo_url ?? "" }))} />
    <TruncatedText text={clubName || t("events.club")} className={CLUB_NAME_CLASS} />
    {cohosts.length > 0 ? <span data-slot="club-cohost-count" className="shrink-0 font-bold">+{cohosts.length}</span> : null}
    <ClubTypeIcon school={school} clubType={clubType} />
  </>;

  if (disabled || !clubName) {
    return (
      <Badge
        asChild
        variant="plain"
        size="inline"
        className="tracking-normal flex min-w-0 max-w-full items-center gap-1"
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
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Badge
          asChild
          variant="plain"
          size="inline"
          className="tracking-normal flex min-w-0 max-w-full items-center gap-1 transition-[background-color,transform] hover:bg-surface-hover active:scale-95 cursor-pointer"
          onMouseDown={onMouseDown}
          onClick={onClick}
        >
          <button type="button" data-slot="club-badge">
            {content}
          </button>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start" stopPropagation>
        {/* One line per host: each opens that club's profile on Wat2Do, where its links live. */}
        {clubs.map((club) => club.id ? (
          <DropdownMenuItem key={club.id} asChild onSelect={onNavigate}>
            <NextLink href={clubPagePath(club.id)}>
              {t("clubs.viewProfile", { name: club.club_name })}
            </NextLink>
          </DropdownMenuItem>
        ) : null)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
