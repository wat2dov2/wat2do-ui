import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";
import { getClubTypeAssetPath } from "@/shared/data/clubTypeAssets";

interface ClubTypeIconProps {
  /** School slug used with clubType to build the asset signature. */
  school: string | null | undefined;
  /** `club_type` from the API. */
  clubType: string | null | undefined;
  className?: string;
}

/**
 * Wordmark for a club's exact school + club-type signature.
 *
 * Renders nothing when the signature has no SVG registered, so call sites can
 * drop it in unconditionally.
 *
 * The wordmark is a mask filled with `currentColor`, so it inherits the
 * surrounding text colour instead of shipping per-theme variants.
 */
export function ClubTypeIcon({
  school,
  clubType,
  className,
}: ClubTypeIconProps) {
  const { t } = useTranslation();
  const assetPath = getClubTypeAssetPath(school, clubType);

  if (!assetPath || !clubType) return null;

  const label = t("clubs.clubType", {
    type: clubType.toUpperCase(),
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
