import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";
import { getStudentAssociation } from "@/shared/constants/schools";

interface OrganizationAssociationBadgeProps {
  /** School slug the organization belongs to; selects which association wordmark to show. */
  school: string | null | undefined;
  /** `association_affiliated` from the API. */
  affiliated: boolean | null | undefined;
  className?: string;
}

/**
 * Wordmark of the student association an organization is affiliated with.
 *
 * Renders nothing when the organization is unaffiliated or its school has no
 * association registered, so call sites can drop it in unconditionally.
 *
 * The wordmark is a mask filled with `currentColor`, so it inherits the
 * surrounding text colour instead of shipping per-theme variants.
 */
export function OrganizationAssociationBadge({
  school,
  affiliated,
  className,
}: OrganizationAssociationBadgeProps) {
  const { t } = useTranslation();
  const association = getStudentAssociation(school);

  if (!affiliated || !association) return null;

  const label = t("organizations.associationAffiliated", {
    association: association.shortName,
  });

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        maskImage: `url(${association.wordmarkUrl})`,
        WebkitMaskImage: `url(${association.wordmarkUrl})`,
      }}
      className={cn(
        "inline-block h-2 w-8 shrink-0 bg-current text-foreground",
        "[mask-size:contain] [mask-repeat:no-repeat] [mask-position:left_center]",
        "[-webkit-mask-size:contain] [-webkit-mask-repeat:no-repeat] [-webkit-mask-position:left_center]",
        className,
      )}
    />
  );
}
