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

interface OrganizationBadgeDropdownProps {
  organizationName: string;
  badgeHoverProps?: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  disabled?: boolean;
}

export function OrganizationBadgeDropdown({
  organizationName,
  badgeHoverProps,
  disabled = false,
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
      <span className="text-[11px] tracking-normal px-2.5 py-1 rounded-full bg-background border border-foreground text-foreground flex items-center gap-0.5 opacity-70">
        <span className="font-bold truncate max-w-[128px]">
          {organizationName || t("events.organization")}
        </span>
        {organizationName && organizationName !== t("events.organization") && (
          <OrganizationVerifiedBadge />
        )}
      </span>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onMouseEnter={badgeHoverProps?.onMouseEnter}
          onMouseLeave={badgeHoverProps?.onMouseLeave}
          className="text-[11px] tracking-normal px-2.5 py-1 rounded-full bg-background border border-foreground text-foreground flex items-center gap-0.5 transition-[background-color,opacity] opacity-70 hover:bg-muted/20 hover:opacity-100 active:scale-95 cursor-pointer"
        >
          <span className="font-bold truncate max-w-[128px]">
            {organizationName}
          </span>
          <OrganizationVerifiedBadge />
        </button>
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
