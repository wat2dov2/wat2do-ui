"use client";

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { BadgeMask } from "@/shared/ui/badge-mask";
import type { BadgeMaskVariant } from "@/shared/ui/badge-mask-paths";
import { EventImageCutout, useEventImageCutouts } from "@/shared/ui/event-image-cutout";

/** `display` for the hero and closing; `section` for the cards that explain Wat2Do. */
export type LandingCardSize = "display" | "section";

/** What sits in each corner that carries a badge. */
export type LandingCardCorners = Partial<Record<BadgeMaskVariant, ReactNode>>;

const CONTENT_PADDING: Record<LandingCardSize, string> = {
  display: "px-4 py-10 sm:px-12 sm:py-16",
  section: "p-5 sm:p-6",
};

interface LandingCardProps {
  /** Badges notched into the card's corners, cut the way an event card's poster badges are. */
  corners?: LandingCardCorners;
  size?: LandingCardSize;
  children: ReactNode;
}

/**
 * The landing page's one surface, in the event card's language: a face with
 * badges set into notches in its corners. The notches are real holes cut by
 * `EventImageCutout` from the badges' measured sizes, and the badges sit in
 * the card's flow, so content always starts below the tallest one, however
 * a translation wraps it.
 */
export function LandingCard({ corners = {}, size = "section", children }: LandingCardProps) {
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();

  const corner = (variant: BadgeMaskVariant) =>
    corners[variant] ? (
      <BadgeMask variant={variant} cutout inFlow containerRef={registerCorner(variant)}>
        {corners[variant]}
      </BadgeMask>
    ) : null;
  /*
   * When a row's two badges do not both fit, the start one truncates and the
   * end one (a count, a price, an action) stays whole, up to most of the row.
   * Two fillets must fit between neighbouring notches, with room to spare.
   */
  const row = (start: BadgeMaskVariant, end: BadgeMaskVariant, align: "start" | "end") =>
    corners[start] || corners[end] ? (
      <div className={cn("relative z-10 flex gap-x-[calc(var(--notch-fillet)*3)]", align === "end" ? "items-end" : "items-start")}>
        <div className="flex min-w-0 flex-1">{corner(start)}</div>
        {corners[end] ? <div className="flex max-w-[70%] shrink-0">{corner(end)}</div> : null}
      </div>
    ) : null;

  return (
    <div
      ref={surfaceRef}
      data-notch-size={size === "display" ? "display" : undefined}
      className="relative flex flex-col overflow-hidden rounded-xl"
    >
      {/* The event card's own face colour, so skeletons, controls and the feed read on it as they do there. */}
      <EventImageCutout
        backgroundColor="var(--surface-elevated)"
        imageFallback={null}
        cutouts={cutouts}
        box={box}
        className="absolute inset-0"
      />
      {row("top-left", "top-right", "start")}
      <div className={cn("relative flex-1", CONTENT_PADDING[size])}>{children}</div>
      {row("bottom-left", "bottom-right", "end")}
    </div>
  );
}

interface LandingNotchLabelProps {
  icon?: LucideIcon;
  /** Matches the card it is notched into. */
  size?: LandingCardSize;
  children: ReactNode;
}

/** A plain label in a notch, like the club name on an event card. Long text truncates. */
export function LandingNotchLabel({ icon: Icon, size = "section", children }: LandingNotchLabelProps) {
  return (
    <Badge variant="plain" size={size === "display" ? "display" : "lg"} className="min-w-0 gap-1.5">
      {Icon ? <Icon aria-hidden="true" className="size-[1.15em] shrink-0" /> : null}
      <span className="truncate">{children}</span>
    </Badge>
  );
}

/** The filled icon chip that marks what an explainer card is about. */
export function LandingNotchIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Badge variant="default" size="lg" aria-hidden="true">
      <Icon className="size-4" />
    </Badge>
  );
}

/** Cards in even columns: one on phones, two from tablets, three on desktop when asked. */
export function LandingCardGrid({ columns, children }: { columns: 2 | 3; children: ReactNode }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 sm:gap-4", columns === 3 && "lg:grid-cols-3")}>
      {children}
    </div>
  );
}

/** A card that holds one product illustration beside its feature copy, marked with what it shows. */
export function LandingStage({ icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <LandingCard corners={{ "top-left": <LandingNotchIcon icon={icon} /> }}>
      <div className="flex min-h-72 items-center justify-center sm:px-6 sm:pb-6">{children}</div>
    </LandingCard>
  );
}

/** A card's title and its explanation. */
export function LandingCardCopy({ title, description }: { title: ReactNode; description: ReactNode }) {
  return (
    <Stack gap={2}>
      <h3 className="text-xl font-medium tracking-[-0.01em] text-balance text-foreground">{title}</h3>
      <p className="max-w-prose leading-relaxed text-pretty text-muted-foreground">{description}</p>
    </Stack>
  );
}
