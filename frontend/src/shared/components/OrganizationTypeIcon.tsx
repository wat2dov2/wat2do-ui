import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";
import { getOrganizationTypeAssetPath } from "@/shared/data/organizationTypeAssets";

interface OrganizationTypeIconProps {
  /** School slug used with organizationType to build the asset signature. */
  school: string | null | undefined;
  /** `organization_type` from the API. */
  organizationType: string | null | undefined;
  className?: string;
}

/**
 * Wordmark for an organization's exact school + organization-type signature.
 *
 * Renders nothing when the signature has no SVG registered, so call sites can
 * drop it in unconditionally.
 *
 * The wordmark is a mask filled with `currentColor`, so it inherits the
 * surrounding text colour instead of shipping per-theme variants.
 */
export function OrganizationTypeIcon({
  school,
  organizationType,
  className,
}: OrganizationTypeIconProps) {
  const { t } = useTranslation();
  const assetPath = getOrganizationTypeAssetPath(school, organizationType);

  if (!assetPath || !organizationType) return null;

  const label = t("organizations.organizationType", {
    type: organizationType.toUpperCase(),
  });

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        maskImage: `url(${assetPath})`,
        WebkitMaskImage: `url(${assetPath})`,
      }}
      className={cn(
        "inline-block h-3 w-8 max-w-8 shrink-0 bg-current text-foreground",
        "[mask-size:contain] [mask-repeat:no-repeat] [mask-position:left_center]",
        "[-webkit-mask-size:contain] [-webkit-mask-repeat:no-repeat] [-webkit-mask-position:left_center]",
        className,
      )}
    />
  );
}
