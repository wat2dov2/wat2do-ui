import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { queryKeys } from "@/shared/lib/queryKeys";
import { getOrganizationByName } from "@/features/organizations/api/organizations.api";
import { useFilterActions } from "@/features/search";
import { OrganizationVerifiedBadge } from "@/features/events/components/OrganizationVerifiedBadge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Skeleton } from "@/shared/ui/skeleton";
import { Badge } from "@/shared/ui/badge";

interface OrganizationBadgeDropdownProps {
  organizationName: string;
  organizationType?: string | null;
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

  const { data: organization, isLoading } = useQuery({
    queryKey: queryKeys.organizations.byName(organizationName),
    queryFn: () => getOrganizationByName(organizationName),
    enabled: isOpen && !disabled && !!organizationName,
  });

  const effectiveOrgType = organizationType ?? organization?.organization_type;
  const showVerified = effectiveOrgType?.toUpperCase() === "WUSA";

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
        className="tracking-normal bg-background border-foreground text-foreground flex items-center gap-0.5 opacity-70"
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
          className="tracking-normal bg-background border-foreground text-foreground flex items-center gap-0.5 transition-[background-color,opacity] opacity-70 hover:bg-muted/20 hover:opacity-100 active:scale-95 cursor-pointer"
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

        {isLoading ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <>
            {organization?.organization_page && (
              <DropdownMenuItem
                onSelect={() => handleLinkSelect(organization.organization_page)}
              >
                {t("organizations.visitWebsite")}
              </DropdownMenuItem>
            )}
            {organization?.ig && (
              <DropdownMenuItem
                onSelect={() => {
                  const igUrl = organization.ig.startsWith("http")
                    ? organization.ig
                    : `https://instagram.com/${organization.ig}`;
                  handleLinkSelect(igUrl);
                }}
              >
                {t("organizations.instagram")}
              </DropdownMenuItem>
            )}
            {organization?.discord && (
              <DropdownMenuItem
                onSelect={() => handleLinkSelect(organization.discord)}
              >
                {t("organizations.discord")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
