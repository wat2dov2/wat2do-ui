import { useTranslation } from "react-i18next";
import {
  CoverSlideTemplate,
  EventSlideTemplate,
} from "@/features/admin/components/instagram/slides/SlideTemplates";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  buildCoverSlideModel,
  buildEventSlideModel,
  type SlideEvent,
} from "@/features/admin/lib/instagramSlides";

interface CarouselSlidePreviewProps {
  /** Slide 0 is the cover; the rest are event slides in carousel order. */
  slideIndex: number;
  slideCount: number;
  /** The slide's event, or `null` on the cover and on a slide not yet saved. */
  event: SlideEvent | null;
  cover: { schoolName: string; body: string; tiles: string[] };
}

const COVER_INDEX = 0;

/** On-screen width of the 1080x1350 slide; the template itself is unscaled. */
const PREVIEW_WIDTH = 288;
const PREVIEW_SCALE = PREVIEW_WIDTH / SLIDE_WIDTH;

export function CarouselSlidePreview({
  slideIndex,
  slideCount,
  event,
  cover,
}: CarouselSlidePreviewProps) {
  const { t } = useTranslation();
  const isCover = slideIndex === COVER_INDEX;

  return (
    <figure className="flex flex-col items-center gap-2">
      <div
        className="overflow-hidden rounded-xl border border-border bg-surface"
        style={{ width: PREVIEW_WIDTH, height: SLIDE_HEIGHT * PREVIEW_SCALE }}
      >
        <div
          style={{
            width: SLIDE_WIDTH,
            height: SLIDE_HEIGHT,
            transform: `scale(${PREVIEW_SCALE})`,
            transformOrigin: "top left",
          }}
        >
          {isCover ? (
            <CoverSlideTemplate model={buildCoverSlideModel(cover)} />
          ) : (
            <EventSlideTemplate model={buildEventSlideModel(event ?? { id: 0 })} />
          )}
        </div>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        {isCover
          ? t("admin.instagramPublishing.coverSlide")
          : t("admin.instagramPublishing.slideOf", { index: slideIndex, count: slideCount - 1 })}
      </figcaption>
    </figure>
  );
}
