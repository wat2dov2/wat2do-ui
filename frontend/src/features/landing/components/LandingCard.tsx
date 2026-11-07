"use client";

import { Fragment, useMemo, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { BadgeMask } from "@/shared/ui/badge-mask";
import type { BadgeMaskVariant } from "@/shared/ui/badge-mask-paths";
import { EventImageCutout, createClipPath, useEventImageCutouts } from "@/shared/ui/event-image-cutout";

/** `display` for the hero and closing; `section` for the cards that explain Wat2Do. */
export type LandingCardSize = "display" | "section";

/** What sits in each corner that carries a badge. */
export type LandingCardCorners = Partial<Record<BadgeMaskVariant, ReactNode>>;

const CORNERS: readonly BadgeMaskVariant[] = ["top-left", "top-right", "bottom-left", "bottom-right"];

const CONTENT_PADDING: Record<LandingCardSize, string> = {
  display: "px-4 py-10 sm:px-12 sm:py-16",
  section: "p-5 sm:p-6",
};

interface LandingCardProps {
  /** Badges notched into the card's corners, cut the way an event card's poster badges are. */
  corners?: LandingCardCorners;
  size?: LandingCardSize;
  /** What the face shows under the content, clipped by the notches like an event card's poster; plain when left out. */
  face?: ReactNode;
  /**
   * The content runs edge to edge under the corner badges and is cut by the
   * same notches, like the poster on an event card. For live product surfaces
   * such as the feed's map.
   */
  bleed?: boolean;
  children: ReactNode;
}

/**
 * The landing page's one surface, in the event card's language: a face with
 * badges set into notches in its corners. The notches are real holes cut by
 * `EventImageCutout` from the badges' measured sizes, and the badges sit in
 * the card's flow, so content always starts below the tallest one, however
 * a translation wraps it.
 */
export function LandingCard({ corners = {}, size = "section", face, bleed = false, children }: LandingCardProps) {
  const { surfaceRef, registerCorner, cutouts, box } = useEventImageCutouts();
  const bleedClipPath = useMemo(() => (bleed ? createClipPath(cutouts, box) : undefined), [bleed, cutouts, box]);

  const corner = (variant: BadgeMaskVariant) =>
    corners[variant] ? (
      <BadgeMask variant={variant} cutout inFlow={!bleed} containerRef={registerCorner(variant)}>
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
        imageContent={face}
        cutouts={cutouts}
        box={box}
        className="absolute inset-0"
      />
      {bleed ? (
        <>
          <div className="relative flex-1" style={{ clipPath: bleedClipPath, WebkitClipPath: bleedClipPath }}>{children}</div>
          {CORNERS.map((variant) => <Fragment key={variant}>{corner(variant)}</Fragment>)}
        </>
      ) : (
        <>
          {row("top-left", "top-right", "start")}
          <div className={cn("relative flex-1", CONTENT_PADDING[size])}>{children}</div>
          {row("bottom-left", "bottom-right", "end")}
        </>
      )}
    </div>
  );
}

/**
 * What a notched label means, as the colour the product uses for it. The legend
 * is the same everywhere on the page:
 * - `school`: the school itself, in its own colour.
 * - `live`: happening or counted right now.
 * - `free`: costs nothing, needs no account.
 * - `new`: freshly read from clubs' posts.
 * - `neutral`: everything else; colour is kept for meaning.
 */
export type LandingNotchTone = "school" | "live" | "free" | "new" | "neutral";

const TONE_VARIANTS = {
  school: "tint-school",
  live: "tint-live",
  free: "tint-free",
  new: "tint-new",
  neutral: "plain",
} as const satisfies Record<LandingNotchTone, string>;

interface LandingNotchLabelProps {
  icon?: LucideIcon;
  tone?: LandingNotchTone;
  /** Matches the card it is notched into. */
  size?: LandingCardSize;
  children: ReactNode;
}

/** A label in a notch, like the club name on an event card, tinted by what it means. Long text truncates. */
export function LandingNotchLabel({ icon: Icon, tone = "neutral", size = "section", children }: LandingNotchLabelProps) {
  return (
    <Badge variant={TONE_VARIANTS[tone]} size={size === "display" ? "display" : "lg"} className="min-w-0 gap-1.5 tabular-nums">
      {Icon ? <Icon aria-hidden="true" className="size-[1.15em] shrink-0" /> : null}
      <span className="truncate">{children}</span>
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

/** A card that holds one product surface beside its feature copy. */
export function LandingStage({ face, children }: { face?: ReactNode; children: ReactNode }) {
  return (
    <LandingCard face={face}>
      <div className="flex min-h-64 items-center justify-center sm:p-4">{children}</div>
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
