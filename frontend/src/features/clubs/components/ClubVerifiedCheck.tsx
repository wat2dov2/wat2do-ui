import { useTranslation } from "react-i18next";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { TapTooltip } from "@/shared/ui/tooltip";

/** The check's size beside each kind of club name. */
const CHECK_SIZES = {
  /** A club badge's 11px name. */
  badge: "size-3.5",
  /** A club card's title. */
  title: "size-4",
  /** A club page's heading. */
  heading: "size-5",
} as const;

interface ClubVerifiedCheckProps {
  clubName: string;
  size?: keyof typeof CHECK_SIZES;
}

/**
 * The blue check after a claimed club's name: someone runs the club on Wat2Do.
 * Hovering or tapping it says so. A press on it never opens the card around it.
 */
export function ClubVerifiedCheck({ clubName, size = "badge" }: ClubVerifiedCheckProps) {
  const { t } = useTranslation();
  return (
    <TapTooltip content={t("events.verifiedTooltip", { club: clubName })}>
      <BadgeCheck
        data-slot="club-verified"
        data-no-card-activate
        role="img"
        aria-label={t("events.verified")}
        className={cn(
          CHECK_SIZES[size],
          "inline-block shrink-0 align-[-0.125em] fill-badge-verified text-badge-verified-foreground [&>path:first-child]:stroke-badge-verified",
        )}
      />
    </TapTooltip>
  );
}
