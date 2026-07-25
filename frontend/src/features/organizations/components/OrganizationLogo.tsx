import { LazyImage } from "@/shared/ui/lazy-image";
import { cn } from "@/shared/lib/utils";
import type { Organization } from "@/shared/types";

interface OrganizationLogoProps {
  organization: Organization;
  className?: string;
}

/**
 * Square profile picture for an organization.
 *
 * Falls back to the first letter of the name so the square never collapses
 * for organizations that have not uploaded a logo.
 */
export function OrganizationLogo({ organization, className }: OrganizationLogoProps) {
  const initial = organization.organization_name.trim().charAt(0);

  return (
    <div
      className={cn(
        "relative size-24 shrink-0 overflow-hidden rounded-xl border border-border bg-surface sm:size-28",
        className,
      )}
    >
      <LazyImage
        src={organization.logo_url ?? undefined}
        alt={organization.organization_name}
        fallback={
          <div className="absolute inset-0 flex items-center justify-center text-3xl font-semibold text-muted-foreground">
            {initial}
          </div>
        }
      />
    </div>
  );
}
