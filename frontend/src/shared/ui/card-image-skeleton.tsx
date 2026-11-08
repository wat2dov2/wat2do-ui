import { useTranslation } from "react-i18next";
import { EVENT_CARD_IMAGE_HEIGHT } from "@/shared/constants/ui";
import { Badge } from "@/shared/ui/badge";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { EventImageCutout, useEventImageCutouts } from "@/shared/ui/event-image-cutout";
import { Skeleton } from "@/shared/ui/skeleton";

/** Match event and position artwork, including the measured New badge notch. */
export function CardImageSkeleton() {
  const { t } = useTranslation();
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();
  return (
    <div
      ref={surfaceRef}
      data-slot="card-image-skeleton"
      data-skeleton-key="card-image"
      aria-hidden="true"
      className="relative shrink-0 overflow-hidden rounded-t-xl rounded-br-xl"
      style={{ height: EVENT_CARD_IMAGE_HEIGHT }}
    >
      <EventImageCutout
        backgroundColor="var(--muted)"
        imageFallback={<Skeleton className="size-full rounded-none" />}
        cutouts={cutouts}
        box={box}
        className="absolute inset-0"
      />
      <BadgeMask variant="top-left" cutout containerRef={registerCorner("top-left")}>
        {/* A flex box, so the placeholder is exactly the badge's box and sits in the card's corner like the real one. */}
        <Skeleton className="flex rounded-xl">
          <Badge size="md" className="invisible">{t("events.new")}</Badge>
        </Skeleton>
      </BadgeMask>
    </div>
  );
}
