"use client";

import { useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { LandingEventViews, type LandingEventView } from "@/features/landing/components/LandingEventViews";
import { LandingBurst } from "@/features/landing/components/LandingMarks";
import { LandingHeading } from "@/features/landing/components/LandingSection";
import { LANDING_ANCHORS } from "@/features/landing/lib/landingAnchors";
import { formatLandingCount } from "@/features/landing/lib/landingStats";
import { ROUTES } from "@/shared/constants/routes";
import { Stack } from "@/shared/layout";
import { Button } from "@/shared/ui/button";
import { ArrowRight } from "@/shared/ui/doodle-icons";
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

/** The pitch, then the school's real feed underneath it in all three views. */
export function LandingHero({ schoolName, events, isLoading }: LandingHeroProps) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<LandingEventView>("map");

  return (
    <Stack as="section" gap={12} className="sm:gap-20">
      <Stack gap={12} align="center" className="pt-6 sm:pt-16">
        <LandingHeading
          as="h1"
          align="center"
          title={
            <>
              {t("landing.hero.titleLead")}{" "}
              {/* The margin reserves the burst's width past the marker, so wrapping and centring count it and it never clips. */}
              <span className="mr-[0.7em] inline-block">
                <Highlighter action="highlight" color="var(--school-marker)">
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
          <p className="text-sm text-muted-foreground">{t("landing.hero.note")}</p>
        </Stack>
      </Stack>

      <Tabs value={view} onValueChange={(value) => setView(value as LandingEventView)}>
        <Stack gap={4}>
          <Stack direction="horizontal" justify="between" align="center" gap={3} wrap>
            {isLoading ? (
              <Skeleton className="h-5 w-64" />
            ) : (
              <p className="text-sm font-semibold text-muted-foreground">
                {t("landing.hero.mapTitle", { count: events.length, total: formatLandingCount(events.length, i18n.language), school: schoolName })}
              </p>
            )}
            <TabsList>
              {VIEWS.map((option) => (
                <TabsTrigger key={option} value={option}>{t(`events.views.${option}`)}</TabsTrigger>
              ))}
            </TabsList>
          </Stack>
          <LandingEventViews view={view} events={events} isLoading={isLoading} />
        </Stack>
      </Tabs>
    </Stack>
  );
}
