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
      aria-hidden="true"
      className="relative shrink-0 overflow-hidden rounded-t-xl rounded-br-xl"
      style={{ height: EVENT_CARD_IMAGE_HEIGHT }}
    >
      <EventImageCutout
        backgroundColor="var(--muted)"
        imageFallback={<Skeleton className="size-full rounded-none" />}
        cutouts={cutouts}
        width={box.width}
        height={box.height}
        className="absolute inset-0"
      />
      <BadgeMask variant="top-left" cutout containerRef={registerCorner("top-left")}>
        <Skeleton className="my-1 rounded-xl">
          <Badge size="md" className="invisible">{t("events.new")}</Badge>
        </Skeleton>
      </BadgeMask>
    </div>
  );
}
