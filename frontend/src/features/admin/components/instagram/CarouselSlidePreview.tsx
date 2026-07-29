import { useTranslation } from "react-i18next";
import { CoverSlideTemplate } from "@/features/admin/components/instagram/slides/SlideTemplates";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  buildCoverSlideModel,
} from "@/features/admin/lib/instagramSlides";
import { EventCard } from "@/features/events/components/EventCard";
import type { Event } from "@/shared/types";
import type { SchoolColors } from "@/shared/lib/schoolBranding";

interface CarouselSlidePreviewProps {
  /** Slide 0 is the cover; the rest are event slides in carousel order. */
  slideIndex: number;
  slideCount: number;
  /** The slide's event, or `null` on the cover and on an unloadable slide. */
  event: Event | null;
  cover: Omit<Parameters<typeof buildCoverSlideModel>[0], "colors">;
  coverColors: SchoolColors | null;
  /**
   * The PNG this slide published as, once the run is live.
   *
   * A published slide is history, so it shows the image Instagram was given
   * instead of re-rendering an event that has since moved on.
   */
  publishedAssetUrl?: string | null;
}

const COVER_INDEX = 0;
/** On-screen width of the preview column, matching a feed card. */
const PREVIEW_WIDTH = 288;
/** A full 1080x1350 slide, scaled to the preview column. */
const PREVIEW_SCALE = PREVIEW_WIDTH / SLIDE_WIDTH;

/**
 * What the admin is looking at on a given slide.
 *
 * Once the run is live this is simply the image that was posted. Until then an
 * event slide previews as the app's own grid card, rendered inert: the point
 * of this screen is checking which events are on the carousel and whether their
 * details are right, and the card is the maintained way to show one. The published
 * 1080x1350 image is rendered from the same event data at publish time by
 * `SlideTemplates`, which satori rasterizes server-side.
 */
export function CarouselSlidePreview({
  slideIndex,
  slideCount,
  event,
  cover,
  coverColors,
  publishedAssetUrl,
}: CarouselSlidePreviewProps) {
  const { t } = useTranslation();
  const isCover = slideIndex === COVER_INDEX;

  return (
    <figure className="flex flex-col items-center gap-2" style={{ width: PREVIEW_WIDTH }}>
      {publishedAssetUrl ? (
        <img
          src={publishedAssetUrl}
          alt=""
          className="rounded-xl border border-border"
          style={{ width: PREVIEW_WIDTH, height: SLIDE_HEIGHT * PREVIEW_SCALE }}
        />
      ) : isCover && coverColors ? (
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
            <CoverSlideTemplate model={buildCoverSlideModel({ ...cover, colors: coverColors })} />
          </div>
        </div>
      ) : !isCover && event ? (
        <EventCard event={event} interactive={false} />
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {isCover
            ? t("common.loading")
            : t("admin.instagramPublishing.slideEventUnavailable")}
        </p>
      )}
      <figcaption className="text-xs text-muted-foreground">
        {isCover
          ? t("admin.instagramPublishing.coverSlide")
          : t("admin.instagramPublishing.slideOf", { index: slideIndex, count: slideCount - 1 })}
      </figcaption>
    </figure>
  );
}
