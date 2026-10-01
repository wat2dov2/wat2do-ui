"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRequestSchool } from "@/app/client-providers";
import { useTranslation } from "react-i18next";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { BadgeMask } from "@/shared/ui/badge-mask";
import { EventImageCutout, useEventImageCutouts } from "@/shared/ui/event-image-cutout";
import { ChevronLeft, ChevronRight } from "@/shared/ui/doodle-icons";
import photo0 from "@/assets/utsg-university-college.webp";
import photo1 from "@/assets/york-stadium-selfie.webp";
import photo2 from "@/assets/ocad-sharp-centre.webp";
import photo3 from "@/assets/tmu-recreation-centre.webp";
import photo4 from "@/assets/utsc-welcome-sign.webp";
import photo5 from "@/assets/ocad-sculpture-campus.webp";
import photo6 from "@/assets/ocad-sculpture-portrait.webp";
import photo7 from "@/assets/ocad-sharp-centre-selfie.webp";
import photo8 from "@/assets/tmu-bouldering.webp";
import photo9 from "@/assets/tmu-boulders-selfie.webp";
import photo10 from "@/assets/tmu-reflection.webp";
import photo11 from "@/assets/utsc-campus-walkway.webp";
import photo12 from "@/assets/utsc-indoor-portrait.webp";
import photo13 from "@/assets/utsg-campus-portrait.webp";
import photo14 from "@/assets/utsg-mural-portrait.webp";
import photo15 from "@/assets/utsc-campus-selfie.webp";
import photo16 from "@/assets/york-campus-signpost.webp";
import photo17 from "@/assets/york-lions-portrait.webp";
import photo18 from "@/assets/york-sculpture-campus.webp";
import photo19 from "@/assets/york-sculpture-detail.webp";

// Image placeholder mode, not user-facing input placeholder text.
const imagePlaceholder = "blur" as const;

const schoolPhotos = [
  { image: photo0, school: "University of Toronto St. George", schoolSlug: "utsg" },
  { image: photo1, school: "York University", schoolSlug: "yorku" },
  { image: photo2, school: "OCAD University", schoolSlug: "ocadu" },
  { image: photo3, school: "Toronto Metropolitan University", schoolSlug: "tmu" },
  { image: photo4, school: "University of Toronto Scarborough", schoolSlug: "utsc" },
  { image: photo5, school: "OCAD University", schoolSlug: "ocadu" },
  { image: photo6, school: "OCAD University", schoolSlug: "ocadu" },
  { image: photo7, school: "OCAD University", schoolSlug: "ocadu" },
  { image: photo8, school: "Toronto Metropolitan University", schoolSlug: "tmu" },
  { image: photo9, school: "Toronto Metropolitan University", schoolSlug: "tmu" },
  { image: photo10, school: "Toronto Metropolitan University", schoolSlug: "tmu" },
  { image: photo11, school: "University of Toronto Scarborough", schoolSlug: "utsc" },
  { image: photo12, school: "University of Toronto Scarborough", schoolSlug: "utsc" },
  { image: photo13, school: "University of Toronto St. George", schoolSlug: "utsg" },
  { image: photo14, school: "University of Toronto St. George", schoolSlug: "utsg" },
  { image: photo15, school: "University of Toronto Scarborough", schoolSlug: "utsc" },
  { image: photo16, school: "York University", schoolSlug: "yorku" },
  { image: photo17, school: "York University", schoolSlug: "yorku" },
  { image: photo18, school: "York University", schoolSlug: "yorku" },
  { image: photo19, school: "York University", schoolSlug: "yorku" },
];

/** Manual navigation keeps photos still for reading and avoids autoplay downloads. */
export function SchoolPhotoCarousel({ isLoading = false }: { isLoading?: boolean }) {
  const { t } = useTranslation();
  const school = useRequestSchool();
  const photos = useMemo(() => [
    ...schoolPhotos.filter(photo => photo.schoolSlug === school),
    ...schoolPhotos.filter(photo => photo.schoolSlug !== school),
  ], [school]);
  const [position, setPosition] = useState({ school, index: 0 });
  const index = position.school === school ? position.index : 0;
  const touchStart = useRef<number | null>(null);
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const photo = photos[index];
  useEffect(() => {
    if (isLoading || loadedSrc !== photo.image.src) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData) return;
    // Warm only neighboring slides after the visible image has finished.
    for (const offset of [-1, 1]) {
      const adjacent = new window.Image();
      adjacent.fetchPriority = "low";
      adjacent.src = photos[(index + offset + photos.length) % photos.length].image.src;
    }
  }, [index, isLoading, loadedSrc, photo.image.src, photos]);

  const navigate = (offset: number) => {
    if (!isLoading) setPosition({ school, index: (index + offset + photos.length) % photos.length });
  };

  return (
    <Stack gap={4}>
      <Stack
        role="region"
        aria-busy={isLoading}
        aria-label={t("contact.photos.label")}
        gap={3}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          navigate(event.key === "ArrowRight" ? 1 : -1);
        }}
      >
        <div
          ref={surfaceRef}
          className="relative aspect-[4/3] w-full touch-pan-y overflow-hidden rounded-3xl"
          onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
          onTouchCancel={() => { touchStart.current = null; }}
          onTouchEnd={(event) => {
            if (touchStart.current === null) return;
            const distance = touchStart.current - event.changedTouches[0].clientX;
            touchStart.current = null;
            if (Math.abs(distance) > 50) navigate(distance > 0 ? 1 : -1);
          }}
        >
          <EventImageCutout
            backgroundColor="var(--muted)"
            cutouts={cutouts}
            width={box.width}
            height={box.height}
            className="absolute inset-0"
            imageContent={isLoading ? (
              <Skeleton className="absolute inset-0 rounded-none" />
            ) : (
              <Image
                key={photo.image.src}
                src={photo.image}
                alt={t("contact.photos.alt", { school: photo.school })}
                fill
                unoptimized
                loading="eager"
                fetchPriority={index === 0 ? "high" : "auto"}
                onLoad={() => setLoadedSrc(photo.image.src)}
                preload={index === 0}
                placeholder={imagePlaceholder}
                className="select-none object-contain"
              />
            )}
          />
          <BadgeMask variant="bottom-left" cutout containerRef={registerCorner("bottom-left")}>
            <h1 className="min-w-0 break-words px-3 py-2 font-sans text-lg font-bold leading-snug tracking-tight text-foreground sm:text-xl">
              {t("contact.hero.line1")} {t("contact.hero.line2")}
            </h1>
          </BadgeMask>
        </div>
        <Stack direction="horizontal" align="center" justify="between" gap={3}>
          <Button variant="outline" size="icon-lg" disabled={isLoading} aria-label={t("contact.photos.previous")} onClick={() => navigate(-1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Stack gap={1} align="center" aria-live="polite" aria-atomic="true">
            <p className="text-center text-sm font-medium">{photo.school}</p>
            <p className="text-sm text-muted-foreground">
              {t("contact.photos.position", { current: index + 1, total: photos.length })}
            </p>
          </Stack>
          <Button variant="outline" size="icon-lg" disabled={isLoading} aria-label={t("contact.photos.next")} onClick={() => navigate(1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}
