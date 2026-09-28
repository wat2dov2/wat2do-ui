import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/ui/skeleton";

/** Reserves the map viewport without importing the map renderer. */
export function PosterMapSkeleton({ height }: { height: string }) {
  const { t } = useTranslation();

  return (
    <Skeleton
      className="w-full rounded-xl"
      style={{ height }}
      role="status"
      aria-busy="true"
      aria-label={t("posters.map.loading")}
    />
  );
}
