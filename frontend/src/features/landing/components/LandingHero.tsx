"use client";

import { useCallback, useRef, useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EventPixelMosaic, LandingMosaicScrim } from "@/features/landing/components/EventPixelMosaic";
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
import { ArrowRight, Check, MapPin, Radio, Sparkles } from "lucide-react";
import { Highlighter } from "@/shared/ui/highlighter";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import type { Event } from "@/shared/types";

const VIEWS: readonly LandingEventView[] = ["map", "grid", "calendar"];

/**
 * The headline's rotating phrases, each with the posters its mosaic wave brings
 * in (the topics `npm run build-event-mosaic` sorts posters into; null mixes them all).
 */
const TITLE_WORDS = [
  { key: "event", topic: null },
  { key: "networking", topic: "networking" },
  { key: "social", topic: "social" },
  { key: "position", topic: "position" },
] as const;

interface LandingHeroProps {
  schoolName: string;
  events: Event[];
  /** Clubs in the school's directory; null when it is unavailable, undefined while it loads. */
  clubCount: number | null | undefined;
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
 * scraped posters with the Wat2Do logo drawn in them above the headline. Each
 * time the headline's phrase changes, a wave refills the mosaic with that
 * phrase's posters. The corners carry the school, the live count, what it costs
 * and where the events come from; the school's real feed follows in all three views.
 */
export function LandingHero({ schoolName, events, clubCount, isLoading }: LandingHeroProps) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<LandingEventView>("map");
  const logoRegion = useRef<HTMLDivElement>(null);
  const mosaic = useRef<MosaicController | null>(null);
  const phrases = TITLE_WORDS.map(({ key }) => t(`landing.hero.titleWords.${key}`));

  const onMosaicReady = useCallback((controller: MosaicController) => {
    mosaic.current = controller;
  }, []);
  const onPhraseChange = useCallback((index: number) => {
    mosaic.current?.wave(TITLE_WORDS[index]?.topic ?? null);
  }, []);

  return (
    <Stack as="section" gap={4} className="pt-2 sm:gap-6 sm:pt-8">
      <LandingCard
        size="display"
        face={<EventPixelMosaic variant="logo" logoRegion={logoRegion} onReady={onMosaicReady} />}
        corners={{
          "top-left": <LandingNotchLabel size="display" tone="school" icon={MapPin}>{schoolName}</LandingNotchLabel>,
          // An empty feed leaves the corner whole rather than notching it for a zero.
          "top-right": isLoading || events.length > 0 ? <HeroLiveCount events={events} isLoading={isLoading} /> : null,
          "bottom-left": <LandingNotchLabel size="display" tone="free" icon={Check}>{t("landing.hero.badges.free")}</LandingNotchLabel>,
          "bottom-right": <LandingNotchLabel size="display" tone="new" icon={Sparkles}>{t("landing.hero.badges.source")}</LandingNotchLabel>,
        }}
      >
        {/* Where the mosaic draws the logo, clear of the text below it. */}
        <div ref={logoRegion} className="h-48 sm:h-80" />
        <Stack gap={8} align="center" className="relative">
          <LandingMosaicScrim />
          <div className="relative w-full">
            <LandingHeading
              as="h1"
              align="center"
              title={
                <>
                  {/* One stable sentence for assistive tech; the three visual lines below are hidden from it. */}
                  <span className="sr-only">
                    {[t("landing.hero.titleLeadBefore"), phrases[0], t("landing.hero.titleHighlight")].join(" ")}
                  </span>
                  <span aria-hidden="true" className="block">{t("landing.hero.titleLeadBefore")}</span>
                  <LandingRotatingWord phrases={phrases} onChange={onPhraseChange} />
                  <span aria-hidden="true" className="block">
                    <Highlighter color="var(--school-marker)">
                      <span className="text-school-marker-foreground">{t("landing.hero.titleHighlight")}</span>
                    </Highlighter>
                  </span>
                </>
              }
              description={t("landing.hero.description")}
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
            {/* The concrete number behind "every": how many clubs this school's feed reads. */}
            {clubCount === undefined ? (
              <Skeleton className="h-5 w-56" />
            ) : clubCount !== null ? (
              <p className="text-center text-sm text-muted-foreground tabular-nums">
                {formatLandingCount(clubCount, i18n.language)} {t("landing.solution.stats.clubsLabel", { count: clubCount, school: schoolName })}
              </p>
            ) : null}
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
