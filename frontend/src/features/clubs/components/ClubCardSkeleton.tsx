import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Skeleton, SkeletonLine } from "@/shared/ui/skeleton";
import { CLUB_CARD_CLASSES } from "@/features/clubs/components/ClubCard";

/**
 * The club card before the directory loads, box for box: logo and follow
 * button, a two-line name with its handle, then the category and counts line.
 */
export function ClubCardSkeleton() {
  const { t } = useTranslation();
  return (
    <article data-club-card-skeleton data-skeleton-key="card" aria-hidden="true" className={CLUB_CARD_CLASSES.card}>
      <div className={CLUB_CARD_CLASSES.top} data-skeleton-key="card-top">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <Skeleton className="rounded-xl">
          <Button type="button" variant="outline" size="sm" tabIndex={-1} className="invisible">
            <Plus />
            {t("clubs.follow")}
          </Button>
        </Skeleton>
      </div>
      <div className={CLUB_CARD_CLASSES.name}>
        <div className={CLUB_CARD_CLASSES.title}>
          <SkeletonLine />
          <SkeletonLine className="w-2/3" />
        </div>
        <div className={CLUB_CARD_CLASSES.handle}><SkeletonLine className="w-1/2" /></div>
      </div>
      <div className={CLUB_CARD_CLASSES.meta} data-skeleton-key="card-meta">
        <span className="w-full"><SkeletonLine className="w-2/3" /></span>
      </div>
    </article>
  );
}
