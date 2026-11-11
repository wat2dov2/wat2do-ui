"use client";

import { useRef, useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EventPixelMosaic } from "@/features/landing/components/EventPixelMosaic";
import { LandingCard, LandingNotchLabel } from "@/features/landing/components/LandingCard";
import { LandingEventViews, type LandingEventView } from "@/features/landing/components/LandingEventViews";
import { MosaicButtonRegion, useMosaicButtons } from "@/features/landing/components/MosaicButtons";
import { ROUTES } from "@/shared/constants/routes";
import { PageBleed, Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { ArrowRight, Check, Instagram } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import type { Event } from "@/shared/types";

const VIEWS: readonly LandingEventView[] = ["map", "grid", "calendar"];

/** The headline's rotating phrases, which the mosaic respells square by square as they turn. */
const TITLE_WORDS = ["event", "networking", "social", "position"] as const;

interface LandingHeroProps {
  events: Event[];
  isLoading: boolean;
}

/**
 * The pitch on a band that runs edge to edge from the top of the page, under
 * the see-through navigation, its whole face a mosaic of scraped posters that
 * never stops changing, with the Wat2Do logo, the headline and the two buttons
 * spelled in its squares; each time the rotating phrase turns, its letters
 * respell square by square. The bottom corners say what it costs and where the
 * events come from; the school's real feed follows in all three views.
 */
export function LandingHero({ events, isLoading }: LandingHeroProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<LandingEventView>("map");
  const logoRegion = useRef<HTMLDivElement>(null);
  const titleRegion = useRef<HTMLDivElement>(null);
  const lead = t("landing.hero.titleLeadBefore");
  const phrases = TITLE_WORDS.map((key) => t(`landing.hero.titleWords.${key}`));
  /** How tall the mosaic's spelled headline is; null until it has laid it out. */
  const [titleHeight, setTitleHeight] = useState<number | null>(null);
  const actions = [
    { href: ROUTES.EVENTS, label: t("landing.hero.primaryAction") },
    { href: ROUTES.ABOUT, label: t("landing.hero.secondaryAction") },
  ];
  const buttons = useMosaicButtons(actions);

  return (
    <Stack as="section" gap={4} className="sm:gap-6">
      <PageBleed underNav>
        <LandingCard
          size="hero"
          face={
            <EventPixelMosaic
              logoRegion={logoRegion}
              title={{ lead, phrases, region: titleRegion, onLayout: setTitleHeight }}
              buttons={buttons.mosaic}
            />
          }
          corners={{
            "bottom-left": <LandingNotchLabel size="hero" tone="free" icon={Check}>{t("landing.hero.badges.free")}</LandingNotchLabel>,
            "bottom-right": <LandingNotchLabel size="hero" tone="new" icon={Instagram}>{t("landing.hero.badges.source")}</LandingNotchLabel>,
          }}
        >
          {/* Where the mosaic draws the logo, clear of the text below it. */}
          <div ref={logoRegion} className="h-32 sm:h-56" />
          {/*
            Where the mosaic spells the headline in posters, always on two lines. Its height is
            the mosaic's layout; until then it holds about that much room.
          */}
          <div
            ref={titleRegion}
            aria-hidden="true"
            className={cn(titleHeight === null && "h-16 sm:h-56")}
            style={titleHeight === null ? undefined : { height: titleHeight }}
          />
          {/* The headline exists only as mosaic squares; screen readers get it as one sentence. */}
          <h1 className="sr-only">{[lead, phrases[0]].join(" ")}</h1>
          <MosaicButtonRegion actions={actions} state={buttons.region} className="mt-8" />
        </LandingCard>
      </PageBleed>

      <Tabs value={view} onValueChange={(value) => setView(value as LandingEventView)}>
        <LandingCard
          bleed
          corners={{
            "top-left": (
              <TabsList>
                {VIEWS.map((option) => (
                  <TabsTrigger key={option} value={option}>{t(`events.views.${option}`)}</TabsTrigger>
                ))}
              </TabsList>
            ),
            "bottom-right": (
              <Button variant="ghost" size="sm" asChild>
                <NextLink href={ROUTES.EVENTS}>
                  {t("landing.hero.primaryAction")}
                  <ArrowRight aria-hidden="true" />
                </NextLink>
              </Button>
            ),
          }}
        >
          <LandingEventViews view={view} events={events} isLoading={isLoading} />
        </LandingCard>
      </Tabs>
    </Stack>
  );
}
