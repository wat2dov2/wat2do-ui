import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { X } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";
import { CoverSlideTemplate, EventSlideTemplate, type SlidePosterProps } from "@/features/admin/components/instagram/slides/SlideTemplates";
import { LazyImage } from "@/shared/ui/lazy-image";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  buildCoverSlideModel,
  buildEventSlideModel,
  type EventSlideModel,
} from "@/features/admin/lib/instagramSlides";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import type { Event } from "@/shared/types";
import type { SchoolColors } from "@/shared/lib/schoolBranding";

interface CarouselSlidePreviewProps {
  onRemove?: () => void;
  onPositionChange?: (position: number) => void;
  disabled?: boolean;
  removeDisabled?: boolean;
  selected?: boolean;
  onSelect?: () => void;
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

/** Drafts preview the exact published template; published assets remain historical. */
export function CarouselSlidePreview({
  slideIndex,
  slideCount,
  event,
  cover,
  coverColors,
  publishedAssetUrl,
  selected,
  onSelect,
  onRemove,
  onPositionChange,
  disabled,
  removeDisabled,
}: CarouselSlidePreviewProps) {
  const { t } = useTranslation();
  const { getSchoolTimezone } = useSchoolDirectory();
  const isCover = slideIndex === COVER_INDEX;
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_WIDTH);
  const previewScale = previewWidth / SLIDE_WIDTH;
  const [modelResult, setModelResult] = useState<{
    event: Event; language: typeof cover.language; model: EventSlideModel | null;
  } | null>(null);
  const currentResult = modelResult?.event === event && modelResult?.language === cover.language ? modelResult : null;
  const slideModel = currentResult?.model;
  const modelError = currentResult && !slideModel;
  const renderPoster = ({ src, width, height, fit }: SlidePosterProps) => (
    <div style={{ position: "relative", width, height }}>
      <LazyImage
        src={src}
        alt=""
        sizes={`${Math.ceil(width * previewScale)}px`}
        fit={fit}
        className="absolute inset-0"
      />
    </div>
  );

  useEffect(() => {
    if (isCover || publishedAssetUrl || !event) return;
    let active = true;
    // Publishing uses the first stored occurrence, including for recurring events.
    buildEventSlideModel({ ...event, ...event.occurrences[0], id: event.id, tz: getSchoolTimezone(event.school) }, cover.language).then(
      model => { if (active) setModelResult({ event, language: cover.language, model }); },
      () => { if (active) setModelResult({ event, language: cover.language, model: null }); },
    );
    return () => { active = false; };
  }, [event, cover.language, getSchoolTimezone, isCover, publishedAssetUrl]);

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    const measure = () => setPreviewWidth(node.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={previewRef} className="relative isolate flex max-w-full flex-col gap-2" style={{ width: PREVIEW_WIDTH }}>
      {!isCover && onRemove && (
        <div className="absolute right-2 top-2 z-20" onPointerDown={(event) => event.stopPropagation()}>
          <Button variant="outline" size="icon-sm" disabled={disabled || removeDisabled}
            aria-label={t("admin.instagramPublishing.removeSlide")} onClick={onRemove}>
            <X />
          </Button>
        </div>
      )}
    <figure
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => { if (onSelect && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onSelect(); } }}
      className={cn("relative z-0 flex max-w-full flex-col items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring", onSelect && "cursor-pointer", selected && "ring-2 ring-primary")}
      style={{ width: "100%" }}
    >
      {publishedAssetUrl || (isCover && coverColors) || (!isCover && slideModel) ? (
        <div
          className="relative overflow-hidden rounded-xl border border-border bg-surface"
          style={{ width: "100%", height: SLIDE_HEIGHT * previewScale }}
        >
          {publishedAssetUrl ? (
            <LazyImage src={publishedAssetUrl} alt="" sizes={`${previewWidth}px`} className="absolute inset-0" />
          ) : <div
            style={{
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              transform: `scale(${previewScale})`,
              transformOrigin: "top left",
            }}
          >
            {isCover && coverColors
              ? <CoverSlideTemplate model={buildCoverSlideModel({ ...cover, colors: coverColors })} renderPoster={renderPoster} />
              : slideModel ? <EventSlideTemplate model={slideModel} renderPoster={renderPoster} /> : null}
          </div>}
        </div>
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {modelError ? t("common.error") : isCover || event
            ? t("common.loading")
            : t("admin.instagramPublishing.slideEventUnavailable")}
        </p>
      )}
      {isCover && (
        <figcaption className="text-xs text-muted-foreground">
          {t("admin.instagramPublishing.coverSlide")}
        </figcaption>
      )}
    </figure>
      {!isCover && onPositionChange && (
        <Input
          key={slideIndex}
          format="integer"
          defaultValue={slideIndex}
          disabled={disabled}
          aria-label={t("admin.instagramPublishing.slideOf", { index: slideIndex, count: slideCount - 1 })}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          onBlur={(event) => {
            const position = Number(event.currentTarget.value);
            if (position >= 1 && position < slideCount && position !== slideIndex) {
              onPositionChange(position);
            }
            event.currentTarget.value = String(slideIndex);
          }}
        />
      )}
    </div>
  );
}
