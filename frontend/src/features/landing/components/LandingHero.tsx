"use client";

import { useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { LandingEventViews, type LandingEventView } from "@/features/landing/components/LandingEventViews";
import { LandingArrowToViews, LandingMark } from "@/features/landing/components/LandingMarks";
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
    <Stack as="section" gap={12}>
      <Stack gap={8} align="center">
        <LandingHeading
          as="h1"
          eyebrow={t("landing.hero.eyebrow")}
          title={
            <>
              {t("landing.hero.titleLead")}{" "}
              <Highlighter action="highlight" color="var(--school-marker)">
                <span className="text-school-marker-foreground">
                  <LandingMark kind="burst" tone="yellow">{t("landing.hero.titleHighlight")}</LandingMark>
                </span>
              </Highlighter>
            </>
          }
          description={t("landing.hero.description")}
        />
        {/* `relative` anchors the arrow that points from the buttons down to the live views. */}
        <Stack direction="horizontal" gap={3} wrap justify="center" className="relative">
          <LandingArrowToViews />
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
