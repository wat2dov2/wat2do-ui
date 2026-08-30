import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePathname, useRouter } from "next/navigation";
import { useFilterActions } from "@/features/search/hooks/useFilterState";
import { OrganizationTypeIcon } from "@/shared/components/OrganizationTypeIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Badge } from "@/shared/ui/badge";
import { TruncatedText } from "@/shared/ui/truncated-text";
import { sanitizeHref } from "@/shared/utils/url";

const ORGANIZATION_NAME_CLASS = "max-w-56 font-bold";

function OrganizationLogo({ src }: { src: string | null | undefined }) {
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

interface OrganizationBadgeDropdownProps {
  organizationName: string;
  organizationLogoUrl?: string | null;
  organizationType?: string | null;
  school?: string | null;
  /** Owning organization's link/social fields, embedded on the event response. */
  organizationPage?: string | null;
  organizationIg?: string | null;
  organizationDiscord?: string | null;
  disabled?: boolean;
  onFilterSelect?: () => void;
  onMouseDown?: React.MouseEventHandler;
  onClick?: React.MouseEventHandler;
}

export function OrganizationBadgeDropdown({
  organizationName,
  organizationLogoUrl,
  organizationType,
  school,
  organizationPage,
  organizationIg,
  organizationDiscord,
  disabled = false,
  onFilterSelect,
  onMouseDown,
  onClick,
}: OrganizationBadgeDropdownProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const filterActions = useFilterActions();
  const [isOpen, setIsOpen] = useState(false);

  const handleFilterSelect = useCallback(() => {
    setIsOpen(false);
    if (organizationName) {
      filterActions.updateFilterState({ organizations: [organizationName] });
      onFilterSelect?.();
      if (pathname !== "/") {
        router.push("/");
      }
    }
  }, [organizationName, filterActions, onFilterSelect, pathname, router]);

  const websiteHref = sanitizeHref(organizationPage);
  const instagramHref = sanitizeHref(
    organizationIg
      ? organizationIg.startsWith("http")
        ? organizationIg
        : `https://instagram.com/${organizationIg.replace(/^@/, "")}`
      : null,
  );
  const discordHref = sanitizeHref(organizationDiscord);

  if (disabled || !organizationName) {
    return (
      <Badge
        asChild
        variant="outline"
        size="md"
        className="tracking-normal bg-background border-foreground text-foreground flex min-w-0 max-w-full items-center gap-1.5"
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <span data-slot="organization-badge">
          <OrganizationLogo src={organizationLogoUrl} />
          <TruncatedText
            text={organizationName || t("events.organization")}
            className={ORGANIZATION_NAME_CLASS}
          />
          {organizationName &&
            organizationName !== t("events.organization") && (
              <OrganizationTypeIcon
                school={school}
                organizationType={organizationType}
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
          <button type="button" data-slot="organization-badge">
            <OrganizationLogo src={organizationLogoUrl} />
            <TruncatedText
              text={organizationName}
              className={ORGANIZATION_NAME_CLASS}
            />
            <OrganizationTypeIcon
              school={school}
              organizationType={organizationType}
            />
          </button>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48" align="start" stopPropagation>
        <DropdownMenuItem onSelect={handleFilterSelect}>
          {t("organizations.filterBy", { name: organizationName })}
        </DropdownMenuItem>

        {websiteHref && (
          <DropdownMenuItem asChild>
            <a href={websiteHref} target="_blank" rel="noopener noreferrer">
              {t("organizations.visitWebsite")}
            </a>
          </DropdownMenuItem>
        )}
        {instagramHref && (
          <DropdownMenuItem asChild>
            <a href={instagramHref} target="_blank" rel="noopener noreferrer">
              {t("organizations.instagram")}
            </a>
          </DropdownMenuItem>
        )}
        {discordHref && (
          <DropdownMenuItem asChild>
            <a href={discordHref} target="_blank" rel="noopener noreferrer">
              {t("organizations.discord")}
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
