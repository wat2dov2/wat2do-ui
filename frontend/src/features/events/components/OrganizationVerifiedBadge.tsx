import { useTranslation } from "react-i18next";
import { VerifiedBadge } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";

interface OrganizationVerifiedBadgeProps {
  className?: string;
}

/** Decorative verified indicator shown next to organization names on events. */
export function OrganizationVerifiedBadge({ className }: OrganizationVerifiedBadgeProps) {
  const { t } = useTranslation();
  const label = t("events.verifiedOrganization");

  return (
    <span
      className={cn("inline-flex shrink-0 items-center", className)}
      aria-label={label}
      title={label}
    >
      <VerifiedBadge className="size-3" />
    </span>
  );
}
