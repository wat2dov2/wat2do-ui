"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useTranslation } from "react-i18next";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { BadgeMask } from "@/shared/ui/badge-mask";
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
import photo15 from "@/assets/york-campus-selfie.webp";
import photo16 from "@/assets/york-campus-signpost.webp";
import photo17 from "@/assets/york-lions-portrait.webp";
import photo18 from "@/assets/york-sculpture-campus.webp";
import photo19 from "@/assets/york-sculpture-detail.webp";

// Image placeholder mode, not user-facing input placeholder text.
const imagePlaceholder = "blur" as const;

const photos = [
  { image: photo0, school: "University of Toronto St. George" },
  { image: photo1, school: "York University" },
  { image: photo2, school: "OCAD University" },
  { image: photo3, school: "Toronto Metropolitan University" },
  { image: photo4, school: "University of Toronto Scarborough" },
  { image: photo5, school: "OCAD University" },
  { image: photo6, school: "OCAD University" },
  { image: photo7, school: "OCAD University" },
  { image: photo8, school: "Toronto Metropolitan University" },
  { image: photo9, school: "Toronto Metropolitan University" },
  { image: photo10, school: "Toronto Metropolitan University" },
  { image: photo11, school: "University of Toronto Scarborough" },
  { image: photo12, school: "University of Toronto Scarborough" },
  { image: photo13, school: "University of Toronto St. George" },
  { image: photo14, school: "University of Toronto St. George" },
  { image: photo15, school: "York University" },
  { image: photo16, school: "York University" },
  { image: photo17, school: "York University" },
  { image: photo18, school: "York University" },
  { image: photo19, school: "York University" },
];

/** Manual navigation keeps photos still for reading and avoids autoplay downloads. */
export function SchoolPhotoCarousel({ isLoading = false }: { isLoading?: boolean }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const touchStart = useRef<number | null>(null);
  const photo = photos[index];
  const navigate = (offset: number) => {
    if (!isLoading) setIndex((current) => (current + offset + photos.length) % photos.length);
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
          className="relative aspect-[4/3] w-full touch-pan-y overflow-hidden rounded-3xl bg-muted"
          onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}
          onTouchCancel={() => { touchStart.current = null; }}
          onTouchEnd={(event) => {
            if (touchStart.current === null) return;
            const distance = touchStart.current - event.changedTouches[0].clientX;
            touchStart.current = null;
            if (Math.abs(distance) > 50) navigate(distance > 0 ? 1 : -1);
          }}
        >
          {isLoading ? <Skeleton className="absolute inset-0 rounded-none" /> : <Image
            key={photo.image.src}
            src={photo.image}
            alt={t("contact.photos.alt", { school: photo.school })}
            fill
            sizes="(max-width: 672px) calc(100vw - 32px), 640px"
            preload={index === 0}
            placeholder={imagePlaceholder}
            className="select-none object-contain"
          />}
          <BadgeMask variant="bottom-left">
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
