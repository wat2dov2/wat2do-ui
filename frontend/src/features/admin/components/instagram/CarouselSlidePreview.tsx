import { I18nextProvider, useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { X } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";
import { CoverSlideTemplate } from "@/features/admin/components/instagram/slides/SlideTemplates";
import {
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  buildCoverSlideModel,
  getInstagramSlideLocale,
} from "@/features/admin/lib/instagramSlides";
import { EventCard } from "@/features/events/components/EventCard";
import type { Event } from "@/shared/types";
import type { SchoolColors } from "@/shared/lib/schoolBranding";
import type { i18n } from "i18next";

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
  selected,
  onSelect,
  onRemove,
  onPositionChange,
  disabled,
  removeDisabled,
}: CarouselSlidePreviewProps) {
  const { t } = useTranslation();
  const isCover = slideIndex === COVER_INDEX;
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(PREVIEW_WIDTH);
  const previewScale = previewWidth / SLIDE_WIDTH;
  const [localeResult, setLocaleResult] = useState<{ language: typeof cover.language; locale: i18n | null } | null>(null);
  const slideLocale = localeResult?.language === cover.language ? localeResult.locale : null;
  const localeError = localeResult?.language === cover.language && !localeResult.locale;

  useEffect(() => {
    if (isCover || publishedAssetUrl) return;
    let active = true;
    getInstagramSlideLocale(cover.language).then(
      locale => { if (active) setLocaleResult({ language: cover.language, locale }); },
      () => { if (active) setLocaleResult({ language: cover.language, locale: null }); },
    );
    return () => { active = false; };
  }, [cover.language, isCover, publishedAssetUrl]);

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
      {publishedAssetUrl ? (
        <img
          src={publishedAssetUrl}
          alt=""
          className="rounded-xl border border-border"
          style={{ width: "100%", height: "auto" }}
        />
      ) : isCover && coverColors ? (
        <div
          className="overflow-hidden rounded-xl border border-border bg-surface"
          style={{ width: "100%", height: SLIDE_HEIGHT * previewScale }}
        >
          <div
            style={{
              width: SLIDE_WIDTH,
              height: SLIDE_HEIGHT,
              transform: `scale(${previewScale})`,
              transformOrigin: "top left",
            }}
          >
            <CoverSlideTemplate model={buildCoverSlideModel({ ...cover, colors: coverColors })} />
          </div>
        </div>
      ) : !isCover && event && slideLocale ? (
        <I18nextProvider i18n={slideLocale}>
          <EventCard event={event} interactive={false} />
        </I18nextProvider>
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {localeError ? t("common.error") : isCover || event
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
