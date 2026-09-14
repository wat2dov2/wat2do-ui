import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePathname, useRouter } from "next/navigation";
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

const CLUB_NAME_CLASS = "max-w-56 font-bold";

function ClubLogo({ src }: { src: string | null | undefined }) {
  if (!src) return null;

  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className="size-3 max-h-3 max-w-3 shrink-0 rounded-full object-cover"
    />
  );
}

interface ClubBadgeDropdownProps {
  clubName: string;
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

  const handleFilterSelect = useCallback(() => {
    setIsOpen(false);
    if (clubName) {
      filterActions.updateFilterState({ clubs: [clubName] });
      onFilterSelect?.();
      if (pathname !== "/") {
        router.push("/");
      }
    }
  }, [clubName, filterActions, onFilterSelect, pathname, router]);

  const websiteHref = sanitizeHref(clubPage);
  const instagramHref = sanitizeHref(
    clubIg
      ? clubIg.startsWith("http")
        ? clubIg
        : `https://instagram.com/${clubIg.replace(/^@/, "")}`
      : null,
  );
  const discordHref = sanitizeHref(clubDiscord);

  if (disabled || !clubName) {
    return (
      <Badge
        asChild
        variant="outline"
        size="md"
        className="tracking-normal bg-background border-foreground text-foreground flex min-w-0 max-w-full items-center gap-1.5"
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <span data-slot="club-badge">
          <ClubLogo src={clubLogoUrl} />
          <TruncatedText
            text={clubName || t("events.club")}
            className={CLUB_NAME_CLASS}
          />
          {clubName &&
            clubName !== t("events.club") && (
              <ClubTypeIcon
                school={school}
                clubType={clubType}
              />
            )}
        </span>
      </Badge>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Badge
          asChild
          variant="outline"
          size="md"
          className="tracking-normal bg-background border-foreground text-foreground flex min-w-0 max-w-full items-center gap-1.5 transition-[background-color,transform] hover:bg-surface-hover active:scale-95 cursor-pointer"
          onMouseDown={onMouseDown}
          onClick={onClick}
        >
          <button type="button" data-slot="club-badge">
            <ClubLogo src={clubLogoUrl} />
            <TruncatedText
              text={clubName}
              className={CLUB_NAME_CLASS}
            />
            <ClubTypeIcon
              school={school}
              clubType={clubType}
            />
          </button>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48" align="start" stopPropagation>
        <DropdownMenuItem onSelect={handleFilterSelect}>
          {t("clubs.filterBy", { name: clubName })}
        </DropdownMenuItem>

        {websiteHref && (
          <DropdownMenuItem asChild>
            <a href={websiteHref} target="_blank" rel="noopener noreferrer">
              {t("clubs.visitWebsite")}
            </a>
          </DropdownMenuItem>
        )}
        {instagramHref && (
          <DropdownMenuItem asChild>
            <a href={instagramHref} target="_blank" rel="noopener noreferrer">
              {t("clubs.instagram")}
            </a>
          </DropdownMenuItem>
        )}
        {discordHref && (
          <DropdownMenuItem asChild>
            <a href={discordHref} target="_blank" rel="noopener noreferrer">
              {t("clubs.discord")}
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
