import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePathname, useRouter } from "next/navigation";
import { ROUTES } from "@/shared/constants/routes";
import { useFilterActions } from "@/features/search/hooks/useFilterState";
import { ClubTypeIcon } from "@/shared/components/ClubTypeIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Badge } from "@/shared/ui/badge";
import { TruncatedText } from "@/shared/ui/truncated-text";
import { sanitizeHref } from "@/shared/utils/url";
import { AvatarStack } from "@/shared/ui/avatar-stack";
import type { ApiEventSummaryResponse } from "@/shared/generated";

const CLUB_NAME_CLASS = "max-w-56 flex-1 font-bold";

interface ClubBadgeDropdownProps {
  clubName: string;
  cohosts?: ApiEventSummaryResponse["cohosts"];
  clubLogoUrl?: string | null;
  clubType?: string | null;
  school?: string | null;
  /** Owning club's link/social fields, embedded on the event response. */
  clubPage?: string | null;
  clubIg?: string | null;
  clubDiscord?: string | null;
  disabled?: boolean;
  onFilterSelect?: () => void;
  onMouseDown?: React.MouseEventHandler;
  onClick?: React.MouseEventHandler;
}

export function ClubBadgeDropdown({
  clubName,
  cohosts = [],
  clubLogoUrl,
  clubType,
  school,
  clubPage,
  clubIg,
  clubDiscord,
  disabled = false,
  onFilterSelect,
  onMouseDown,
  onClick,
}: ClubBadgeDropdownProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const filterActions = useFilterActions();
  const [isOpen, setIsOpen] = useState(false);

  const handleFilterSelect = useCallback((name: string) => {
    setIsOpen(false);
    if (name) {
      filterActions.updateFilterState({ clubs: [name] });
      onFilterSelect?.();
      if (pathname !== ROUTES.EVENTS) {
        router.push(ROUTES.EVENTS);
      }
    }
  }, [filterActions, onFilterSelect, pathname, router]);

  const clubs = [{
    club_name: clubName, logo_url: clubLogoUrl, club_page: clubPage,
    ig: clubIg, discord: clubDiscord,
  }, ...cohosts];
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
      <DropdownMenuContent className="w-48" align="start" stopPropagation>
        {clubs.map((club) => {
          const websiteHref = sanitizeHref(club.club_page);
          const instagramHref = sanitizeHref(club.ig
            ? club.ig.startsWith("http") ? club.ig : `https://instagram.com/${club.ig.replace(/^@/, "")}`
            : null);
          const discordHref = sanitizeHref(club.discord);
          return <div key={club.club_name}>
            <DropdownMenuItem onSelect={() => handleFilterSelect(club.club_name)}>
              {t("clubs.filterBy", { name: club.club_name })}
            </DropdownMenuItem>
            {websiteHref ? <DropdownMenuItem asChild><a href={websiteHref} target="_blank" rel="noopener noreferrer">{t("clubs.visitWebsite")}</a></DropdownMenuItem> : null}
            {instagramHref ? <DropdownMenuItem asChild><a href={instagramHref} target="_blank" rel="noopener noreferrer">{t("clubs.instagram")}</a></DropdownMenuItem> : null}
            {discordHref ? <DropdownMenuItem asChild><a href={discordHref} target="_blank" rel="noopener noreferrer">{t("clubs.discord")}</a></DropdownMenuItem> : null}
          </div>;
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
