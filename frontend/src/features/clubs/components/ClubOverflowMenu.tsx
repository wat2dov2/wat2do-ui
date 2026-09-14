import { useTranslation } from "react-i18next";
import { ExternalLink, Discord, MoreHorizontal } from "@/shared/ui/doodle-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { sanitizeHref } from "@/shared/utils/url";
import type { Club } from "@/shared/types";

interface ClubOverflowMenuProps {
  club: Club;
  stopPropagation?: boolean;
}

const ACTION_CLASS =
  "flex min-h-12 w-full items-center justify-center rounded-br-xl border-l border-border px-2 text-muted-foreground transition-colors hover:bg-surface-hover";

export function ClubOverflowMenu({
  club,
  stopPropagation = false,
}: ClubOverflowMenuProps) {
  const { t } = useTranslation();
  const discordHref = club.discord ? sanitizeHref(club.discord) : null;
  const websiteHref = club.club_page ? sanitizeHref(club.club_page) : null;

  const items = [
    websiteHref
      ? {
          key: "website",
          href: websiteHref,
          label: t("clubs.viewClubPage"),
          icon: ExternalLink,
        }
      : null,
    discordHref
      ? {
          key: "discord",
          href: discordHref,
          label: t("clubs.discord"),
          icon: Discord,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    href: string;
    label: string;
    icon: typeof ExternalLink;
  }>;

  if (items.length === 0) {
    return (
      <span aria-hidden="true" className={`${ACTION_CLASS} opacity-35`}>
        <MoreHorizontal className="size-5" />
      </span>
    );
  }

  if (items.length === 1) {
    const [{ href, label, icon: Icon }] = items;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={label}
        className={ACTION_CLASS}
      >
        <Icon className="size-5" />
      </a>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("common.moreOptions")}
          title={t("common.moreOptions")}
          className={ACTION_CLASS}
        >
          <MoreHorizontal className="size-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44" align="end" stopPropagation={stopPropagation}>
        {items.map(({ key, href, label, icon: Icon }) => (
          <DropdownMenuItem
            key={key}
            asChild
          >
            <a href={href} target="_blank" rel="noopener noreferrer">
              <Icon className="size-3.5 shrink-0" />
              {label}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
