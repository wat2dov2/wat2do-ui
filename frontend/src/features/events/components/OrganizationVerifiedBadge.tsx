import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";

interface OrganizationVerifiedBadgeProps {
  className?: string;
}

/**
 * Themeable WUSA wordmark: transparent mono mark filled with currentColor
 * (black in light mode, white in dark mode via `text-foreground`).
 */
export function OrganizationVerifiedBadge({ className }: OrganizationVerifiedBadgeProps) {
  const { t } = useTranslation();
  const label = t("events.verifiedOrganization");

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block h-2.5 w-10 shrink-0 bg-current text-foreground",
        "[mask-image:url(/wusa-wordmark.png)] [mask-size:contain] [mask-repeat:no-repeat] [mask-position:left_center]",
        "[-webkit-mask-image:url(/wusa-wordmark.png)] [-webkit-mask-size:contain] [-webkit-mask-repeat:no-repeat] [-webkit-mask-position:left_center]",
        className,
      )}
    />
  );
}
