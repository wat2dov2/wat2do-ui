"use client";

import { useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { LandingCard, LandingNotchLabel } from "@/features/landing/components/LandingCard";
import { LandingEventViews, type LandingEventView } from "@/features/landing/components/LandingEventViews";
import { LandingBurst } from "@/features/landing/components/LandingMarks";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { LANDING_ANCHORS } from "@/features/landing/lib/landingAnchors";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ArrowRight, Check, MapPin, Sparkles } from "lucide-react";
import { Highlighter } from "@/shared/ui/highlighter";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import type { Event } from "@/shared/types";

const VIEWS: readonly LandingEventView[] = ["map", "grid", "calendar"];

interface LandingHeroProps {
  schoolName: string;
  events: Event[];
  isLoading: boolean;
}

/** The school's live count, notched into the hero like the Live badge on an event card. */
function HeroLiveCount({ events, isLoading }: { events: Event[]; isLoading: boolean }) {
  const { t, i18n } = useTranslation();
  if (isLoading) return <Skeleton className="h-7 w-24 rounded-xl sm:h-9 sm:w-40" />;

  return (
    <Stack direction="horizontal" gap={1} align="center" className="min-w-0">
      <Badge variant="live" size="display">{t("common.live")}</Badge>
      <LandingNotchLabel size="display">
        {formatLandingCount(events.length, i18n.language)}
        {/* Phones keep the number; the words join it where there is room. */}
        <span className="hidden sm:inline"> {t("landing.solution.stats.upcomingLabel", { count: events.length })}</span>
      </LandingNotchLabel>
    </Stack>
  );
}

/**
 * The pitch on a card cut like an event card, its corners carrying the school,
 * the live count and what it costs, then the school's real feed in all three views.
 */
export function LandingHero({ schoolName, events, isLoading }: LandingHeroProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<LandingEventView>("map");

  return (
    <Stack as="section" gap={4} className="pt-2 sm:gap-6 sm:pt-8">
      <LandingCard
        size="display"
        corners={{
          "top-left": <LandingNotchLabel size="display" icon={MapPin}>{schoolName}</LandingNotchLabel>,
          // An empty feed leaves the corner whole rather than notching it for a zero.
          "top-right": isLoading || events.length > 0 ? <HeroLiveCount events={events} isLoading={isLoading} /> : null,
          "bottom-left": <LandingNotchLabel size="display" icon={Check}>{t("landing.hero.badges.free")}</LandingNotchLabel>,
          "bottom-right": <LandingNotchLabel size="display" icon={Sparkles}>{t("landing.hero.badges.source")}</LandingNotchLabel>,
        }}
      >
        <Stack gap={12} align="center">
          <LandingHeading
            as="h1"
            align="center"
            title={
              <>
                {t("landing.hero.titleLead")}{" "}
                {/* The margin reserves the burst's width past the marker, so wrapping and centring count it and it never clips. */}
                <span className="mr-[0.7em] inline-block">
                  <Highlighter color="var(--school-marker)">
                    <span className="text-school-marker-foreground">
                      <LandingBurst>{t("landing.hero.titleHighlight")}</LandingBurst>
                    </span>
                  </Highlighter>
                </span>
              </>
            }
            description={t("landing.hero.description")}
          />
          <Stack gap={5} align="center">
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
            {/* Who pays for it, said once, quietly, under the actions. */}
            <p className="text-center text-sm text-muted-foreground">{t("landing.hero.note")}</p>
          </Stack>
        </Stack>
      </LandingCard>

      <Tabs value={view} onValueChange={(value) => setView(value as LandingEventView)}>
        <LandingCard
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
