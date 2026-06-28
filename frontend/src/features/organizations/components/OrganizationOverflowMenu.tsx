import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Instagram, Discord } from "@/shared/ui/doodle-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { sanitizeHref } from "@/shared/utils/url";
import type { Organization } from "@/shared/types";

interface OrganizationOverflowMenuProps {
  organization: Organization;
  children: ReactElement;
  stopPropagation?: boolean;
}

export function OrganizationOverflowMenu({
  organization,
  children,
  stopPropagation = false,
}: OrganizationOverflowMenuProps) {
  const { t } = useTranslation();
  const discordHref = organization.discord ? sanitizeHref(organization.discord) : null;
  const instagramHref = organization.ig ? `https://instagram.com/${organization.ig}` : null;

  const items = [
    instagramHref
      ? {
          key: "instagram",
          href: instagramHref,
          label: t("organizations.instagram"),
          icon: Instagram,
        }
      : null,
    discordHref
      ? {
          key: "discord",
          href: discordHref,
          label: t("organizations.discord"),
          icon: Discord,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    href: string;
    label: string;
    icon: typeof Instagram;
  }>;

  if (items.length === 0) {
    return children;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-44" align="end" stopPropagation={stopPropagation}>
        {items.map(({ key, href, label, icon: Icon }) => (
          <DropdownMenuItem
            key={key}
            onSelect={() => {
              window.open(href, "_blank", "noopener,noreferrer");
            }}
          >
            <Icon className="size-3.5 shrink-0" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
