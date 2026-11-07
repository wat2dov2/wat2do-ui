"use client";

import { useRef, useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EventPixelMosaic } from "@/features/landing/components/EventPixelMosaic";
import { LandingCard, LandingNotchLabel } from "@/features/landing/components/LandingCard";
import { LandingEventViews, type LandingEventView } from "@/features/landing/components/LandingEventViews";
import { LANDING_ANCHORS } from "@/features/landing/lib/landingAnchors";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
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
  const lead = t("landing.hero.titleLeadBefore");
  const phrases = TITLE_WORDS.map((key) => t(`landing.hero.titleWords.${key}`));
  /** How tall the mosaic's spelled headline is; null until it has laid it out. */
  const [titleHeight, setTitleHeight] = useState<number | null>(null);

  return (
    <Stack as="section" gap={4} className="pt-2 sm:gap-6 sm:pt-8">
      <LandingCard
        size="display"
        face={
          <EventPixelMosaic
            variant="logo"
            logoRegion={logoRegion}
            title={{ lead, phrases, region: titleRegion, onLayout: setTitleHeight }}
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
        <Stack direction="horizontal" gap={3} wrap justify="center" className="relative pt-8">
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
