"use client";

import { useRef, useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EventPixelMosaic } from "@/features/landing/components/EventPixelMosaic";
import { LandingCard, LandingNotchLabel } from "@/features/landing/components/LandingCard";
import { splitInTwo } from "@/features/landing/lib/eventMosaicTitle";
import { ROUTES } from "@/shared/constants/routes";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { ArrowRight } from "lucide-react";

/**
 * The last push back to the feed, its line spelled in the mosaic's squares
 * the way the hero's headline is, on two balanced lines.
 */
export function LandingClosing({ schoolName }: { schoolName: string }) {
  const { t } = useTranslation();
  const titleRegion = useRef<HTMLDivElement>(null);
  const title = t("landing.closing.title");
  const [lead, phrase] = splitInTwo(title);
  /** How tall the spelled line is; null until the mosaic has laid it out. */
  const [titleHeight, setTitleHeight] = useState<number | null>(null);

  return (
    <section>
      <LandingCard
        size="display"
        face={<EventPixelMosaic title={{ lead, phrases: [phrase], region: titleRegion, onLayout: setTitleHeight }} />}
        corners={{
          "top-left": <LandingNotchLabel size="display" tone="school">{schoolName}</LandingNotchLabel>,
          "bottom-right": (
            <Button size="lg" asChild>
              <NextLink href={ROUTES.EVENTS}>
                {t("landing.closing.action")}
                <ArrowRight aria-hidden="true" />
              </NextLink>
            </Button>
          ),
        }}
      >
        {/* The line exists only as mosaic squares; screen readers get it as a heading. */}
        <h2 className="sr-only">{title}</h2>
        {/* Where the mosaic spells the line; it holds about that much room until laid out. */}
        <div
          ref={titleRegion}
          aria-hidden="true"
          className={cn(titleHeight === null && "h-24 sm:h-56")}
          style={titleHeight === null ? undefined : { height: titleHeight }}
        />
      </LandingCard>
    </section>
  );
}
