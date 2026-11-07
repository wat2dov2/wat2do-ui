"use client";

import { useCallback, useRef, useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EventPixelMosaic } from "@/features/landing/components/EventPixelMosaic";
import { LandingCard, LandingNotchLabel } from "@/features/landing/components/LandingCard";
import { LandingEventViews, type LandingEventView } from "@/features/landing/components/LandingEventViews";
import { LandingRotatingWord } from "@/features/landing/components/LandingRotatingWord";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { LANDING_ANCHORS } from "@/features/landing/lib/landingAnchors";
import type { MosaicController } from "@/features/landing/lib/eventPixelMosaic";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { ArrowRight, Check, Instagram, MapPin, Radio } from "lucide-react";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import type { Event } from "@/shared/types";

const VIEWS: readonly LandingEventView[] = ["map", "grid", "calendar"];

/** The headline's rotating phrases, which the mosaic respells square by square as they turn. */
const TITLE_WORDS = ["event", "networking", "social", "position"] as const;

interface LandingHeroProps {
  schoolName: string;
  events: Event[];
  isLoading: boolean;
}

/** The school's live count, notched into the hero in the Live colour. */
function HeroLiveCount({ events, isLoading }: { events: Event[]; isLoading: boolean }) {
  const { t, i18n } = useTranslation();
  if (isLoading) return <Skeleton className="h-7 w-24 rounded-xl sm:h-9 sm:w-40" />;

  return (
    <LandingNotchLabel size="display" tone="live" icon={Radio}>
      {formatLandingCount(events.length, i18n.language)}
      {/* Phones keep the number; the words join it where there is room. */}
      <span className="hidden sm:inline"> {t("landing.solution.stats.upcomingLabel", { count: events.length })}</span>
    </LandingNotchLabel>
  );
}

/**
 * The pitch on a card cut like an event card, its whole face a mosaic of
 * scraped posters that never stops changing, with the Wat2Do logo and the
 * headline's first lines spelled in its squares; each time the rotating phrase
 * turns, its letters respell square by square. The corners carry the school, the live count, what it costs
 * and where the events come from; the school's real feed follows in all three views.
 */
export function LandingHero({ schoolName, events, isLoading }: LandingHeroProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<LandingEventView>("map");
  const logoRegion = useRef<HTMLDivElement>(null);
  const titleRegion = useRef<HTMLDivElement>(null);
  const mosaic = useRef<MosaicController | null>(null);
  const lead = t("landing.hero.titleLeadBefore");
  const phrases = TITLE_WORDS.map((key) => t(`landing.hero.titleWords.${key}`));
  /** Whether the mosaic spells the headline's first lines, and how much room they take; until it says so they are text. */
  const [spelled, setSpelled] = useState<{ fits: boolean; height: number }>({ fits: false, height: 0 });

  const onMosaicReady = useCallback((controller: MosaicController) => {
    mosaic.current = controller;
  }, []);
  const onPhraseChange = useCallback((index: number) => {
    mosaic.current?.setPhrase(index);
  }, []);
  const onTitleLayout = useCallback((layout: { fits: boolean; height: number }) => {
    setSpelled((current) => (current.fits === layout.fits && current.height === layout.height ? current : layout));
  }, []);

  return (
    <Stack as="section" gap={4} className="pt-2 sm:gap-6 sm:pt-8">
      <LandingCard
        size="display"
        face={
          <EventPixelMosaic
            variant="logo"
            logoRegion={logoRegion}
            title={{ lead, phrases, region: titleRegion, onLayout: onTitleLayout }}
            onReady={onMosaicReady}
          />
        }
        corners={{
          "top-left": <LandingNotchLabel size="display" tone="school" icon={MapPin}>{schoolName}</LandingNotchLabel>,
          // An empty feed leaves the corner whole rather than notching it for a zero.
          "top-right": isLoading || events.length > 0 ? <HeroLiveCount events={events} isLoading={isLoading} /> : null,
          "bottom-left": <LandingNotchLabel size="display" tone="free" icon={Check}>{t("landing.hero.badges.free")}</LandingNotchLabel>,
          "bottom-right": <LandingNotchLabel size="display" tone="new" icon={Instagram}>{t("landing.hero.badges.source")}</LandingNotchLabel>,
        }}
      >
        {/* Where the mosaic draws the logo, clear of the text below it. */}
        <div ref={logoRegion} className="h-48 sm:h-80" />
        {/*
          Where the mosaic spells "Every campus" and the rotating phrase in posters. Its height
          is the mosaic's layout (it grows for a phrase that wraps), and it is empty where the
          letters would be too small to read, which shows them as text below instead.
        */}
        <div ref={titleRegion} style={{ height: spelled.height }} />
        <Stack gap={8} align="center" className="relative">
          <div className="relative w-full">
            <LandingHeading
              as="h1"
              align="center"
              title={
                <>
                  {/* One stable sentence for assistive tech; the visual lines below are hidden from it. */}
                  <span className="sr-only">{[lead, phrases[0]].join(" ")}</span>
                  {/* Spelled in the mosaic, the lines leave the text; the rotation still keeps time for it. */}
                  <span aria-hidden="true" className={spelled.fits ? "hidden" : "block"}>{lead}</span>
                  <span className={spelled.fits ? "hidden" : "contents"}>
                    <LandingRotatingWord phrases={phrases} onChange={onPhraseChange} />
                  </span>
                </>
              }
            />
          </div>
          <Stack gap={5} align="center" className="relative">
            <Stack direction="horizontal" gap={3} wrap justify="center">
              <Button size="lg" asChild>
                <NextLink href={ROUTES.EVENTS}>
                  {t("landing.hero.primaryAction")}
                  <ArrowRight aria-hidden="true" />
                </NextLink>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href={`#${LANDING_ANCHORS.HOW_IT_WORKS}`}>
                  {t("landing.hero.secondaryAction")}
                </a>
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </LandingCard>

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
