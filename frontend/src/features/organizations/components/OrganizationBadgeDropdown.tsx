import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { usePathname, useRouter } from "next/navigation";
import { useFilterActions } from "@/features/search";
import { OrganizationAssociationBadge } from "@/shared/components/OrganizationAssociationBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Badge } from "@/shared/ui/badge";
import { getStudentAssociation } from "@/shared/constants/schools";

interface OrganizationBadgeDropdownProps {
  organizationName: string;
  associationAffiliated?: boolean | null;
  school?: string | null;
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
  associationAffiliated,
  school,
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

  const showAssociation = Boolean(associationAffiliated) && Boolean(getStudentAssociation(school));

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
        className="tracking-normal bg-background border-foreground text-foreground flex max-w-full items-center gap-1.5 opacity-70"
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <span>
          <span className="min-w-0 truncate font-bold">
            {organizationName || t("events.organization")}
          </span>
          {organizationName && organizationName !== t("events.organization") && showAssociation && (
            <OrganizationAssociationBadge school={school} affiliated={associationAffiliated} />
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
          className="tracking-normal bg-background border-foreground text-foreground flex max-w-full items-center gap-1.5 transition-[background-color,opacity] opacity-70 hover:bg-surface-hover hover:opacity-100 active:scale-95 cursor-pointer"
          onMouseDown={onMouseDown}
          onClick={onClick}
        >
          <button
            type="button"
            onMouseEnter={badgeHoverProps?.onMouseEnter}
            onMouseLeave={badgeHoverProps?.onMouseLeave}
          >
            <span className="min-w-0 truncate font-bold">
              {organizationName}
            </span>
            {showAssociation && <OrganizationAssociationBadge school={school} affiliated={associationAffiliated} />}
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
