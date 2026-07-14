import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePathname, useRouter } from "next/navigation";
import { useFilterActions } from "@/features/search";
import { OrganizationVerifiedBadge } from "@/features/events/components/OrganizationVerifiedBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Badge } from "@/shared/ui/badge";

interface OrganizationBadgeDropdownProps {
  organizationName: string;
  organizationType?: string | null;
  /** Owning organization's link/social fields, embedded on the event response. */
  organizationPage?: string | null;
  organizationIg?: string | null;
  organizationDiscord?: string | null;
  badgeHoverProps?: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  disabled?: boolean;
  onMouseDown?: React.MouseEventHandler;
  onClick?: React.MouseEventHandler;
}

export function OrganizationBadgeDropdown({
  organizationName,
  organizationType,
  organizationPage,
  organizationIg,
  organizationDiscord,
  badgeHoverProps,
  disabled = false,
  onMouseDown,
  onClick,
}: OrganizationBadgeDropdownProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const filterActions = useFilterActions();
  const [isOpen, setIsOpen] = useState(false);

  const showVerified = organizationType?.toUpperCase() === "WUSA";

  const handleFilterSelect = useCallback(() => {
    setIsOpen(false);
    if (organizationName) {
      filterActions.toggleFilterValue("organizations", organizationName);
      if (pathname !== "/") {
        router.push("/");
      }
    }
  }, [organizationName, filterActions, pathname, router]);

  const handleLinkSelect = useCallback((url: string) => {
    setIsOpen(false);
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  if (disabled || !organizationName) {
    return (
      <Badge
        asChild
        variant="outline"
        size="md"
        className="tracking-normal bg-background border-foreground text-foreground flex items-center gap-1.5 opacity-70"
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <span>
          <span className="font-bold truncate max-w-[128px]">
            {organizationName || t("events.organization")}
          </span>
          {organizationName && organizationName !== t("events.organization") && showVerified && (
            <OrganizationVerifiedBadge />
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
          className="tracking-normal bg-background border-foreground text-foreground flex items-center gap-1.5 transition-[background-color,opacity] opacity-70 hover:bg-muted/20 hover:opacity-100 active:scale-95 cursor-pointer"
          onMouseDown={onMouseDown}
          onClick={onClick}
        >
          <button
            type="button"
            onMouseEnter={badgeHoverProps?.onMouseEnter}
            onMouseLeave={badgeHoverProps?.onMouseLeave}
          >
            <span className="font-bold truncate max-w-[128px]">
              {organizationName}
            </span>
            {showVerified && <OrganizationVerifiedBadge />}
          </button>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48" align="start" stopPropagation>
        <DropdownMenuItem onSelect={handleFilterSelect}>
          {t("organizations.filterBy", { name: organizationName })}
        </DropdownMenuItem>

        {organizationPage && (
          <DropdownMenuItem onSelect={() => handleLinkSelect(organizationPage)}>
            {t("organizations.visitWebsite")}
          </DropdownMenuItem>
        )}
        {organizationIg && (
          <DropdownMenuItem
            onSelect={() => {
              const igUrl = organizationIg.startsWith("http")
                ? organizationIg
                : `https://instagram.com/${organizationIg}`;
              handleLinkSelect(igUrl);
            }}
          >
            {t("organizations.instagram")}
          </DropdownMenuItem>
        )}
        {organizationDiscord && (
          <DropdownMenuItem onSelect={() => handleLinkSelect(organizationDiscord)}>
            {t("organizations.discord")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
