"use client";

import { useCallback, useRef, useState } from "react";
import NextLink from "next/link";
import { useTranslation } from "react-i18next";
import { EventPixelMosaic } from "@/features/landing/components/EventPixelMosaic";
import { LandingCard, LandingNotchLabel } from "@/features/landing/components/LandingCard";
import { LandingEventViews, type LandingEventView } from "@/features/landing/components/LandingEventViews";
import type { MosaicButtonLayout } from "@/features/landing/lib/eventPixelMosaic";
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

/** The arrow a hovered button's label makes room for. */
const ARROW = " →";

interface LandingHeroProps {
  events: Event[];
  isLoading: boolean;
}

/** Same rects in the same places, so a repeated layout never re-renders the page. */
function sameLayout(a: MosaicButtonLayout | null, b: MosaicButtonLayout | null) {
  if (!a || !b) return a === b;
  return a.height === b.height && a.rects.length === b.rects.length && a.rects.every((rect, index) => {
    const other = b.rects[index];
    return rect.left === other.left && rect.top === other.top && rect.width === other.width && rect.height === other.height;
  });
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
  const buttonsRegion = useRef<HTMLDivElement>(null);
  const lead = t("landing.hero.titleLeadBefore");
  const phrases = TITLE_WORDS.map((key) => t(`landing.hero.titleWords.${key}`));
  /** How tall the mosaic's spelled headline is; null until it has laid it out. */
  const [titleHeight, setTitleHeight] = useState<number | null>(null);
  /** Where the mosaic spelled the buttons; null until then, or when they do not fit. */
  const [buttonLayout, setButtonLayout] = useState<MosaicButtonLayout | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const onButtonLayout = useCallback(
    (layout: MosaicButtonLayout | null) => setButtonLayout((current) => (sameLayout(current, layout) ? current : layout)),
    [],
  );
  const actions = [
    { href: ROUTES.EVENTS, label: t("landing.hero.primaryAction"), hoverLabel: t("landing.hero.primaryHoverAction") },
    { href: ROUTES.ABOUT, label: t("landing.hero.secondaryAction"), hoverLabel: t("landing.hero.secondaryAction") },
  ];
  const items = actions.map(({ label, hoverLabel }) => ({ label, hoverLabel: `${hoverLabel}${ARROW}` }));

  return (
    <Stack as="section" gap={4} className="sm:gap-6">
      <PageBleed underNav>
        <LandingCard
          size="hero"
          face={
            <EventPixelMosaic
              logoRegion={logoRegion}
              title={{ lead, phrases, region: titleRegion, onLayout: setTitleHeight }}
              buttons={{ items, region: buttonsRegion, hover, onLayout: onButtonLayout }}
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
          {/*
            Where the mosaic spells the buttons, each label in a border of squares. The links lie
            over them, so they are real links to every pointer, keyboard and screen reader; until
            the mosaic has spelled them, or where they do not fit, they are ordinary buttons.
          */}
          <div ref={buttonsRegion} className="relative mt-8" style={buttonLayout ? { height: buttonLayout.height } : undefined}>
            {buttonLayout ? (
              actions.map((action, index) => {
                const rect = buttonLayout.rects[index];
                return (
                  <NextLink
                    key={action.href}
                    href={action.href}
                    aria-label={action.label}
                    className="absolute rounded-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                    onPointerEnter={() => setHover(index)}
                    onPointerLeave={() => setHover((current) => (current === index ? null : current))}
                    onFocus={() => setHover(index)}
                    onBlur={() => setHover((current) => (current === index ? null : current))}
                  />
                );
              })
            ) : (
              <Stack direction="horizontal" gap={3} wrap justify="center">
                {actions.map((action, index) => (
                  <Button key={action.href} size="lg" variant={index === 0 ? "primary" : "outline"} asChild>
                    <NextLink href={action.href}>
                      {action.label}
                      {index === 0 ? <ArrowRight aria-hidden="true" /> : null}
                    </NextLink>
                  </Button>
                ))}
              </Stack>
            )}
          </div>
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
