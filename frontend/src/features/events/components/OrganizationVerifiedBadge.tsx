import Image from "next/image";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";

interface OrganizationVerifiedBadgeProps {
  className?: string;
}

/** WUSA wordmark shown next to verified organization names on events. */
export function OrganizationVerifiedBadge({ className }: OrganizationVerifiedBadgeProps) {
  const { t } = useTranslation();
  const label = t("events.verifiedOrganization");

  return (
    <span
      className={cn("inline-flex shrink-0 items-center", className)}
      aria-label={label}
      title={label}
    >
      <Image
        src="/wusa-wordmark.jpg"
        alt=""
        aria-hidden
        width={56}
        height={14}
        className="h-3.5 w-auto"
      />
    </span>
  );
}
