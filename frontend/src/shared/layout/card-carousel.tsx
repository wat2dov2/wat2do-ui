"use client";

import { Children, isValidElement, useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import NextLink from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Section } from "@/shared/layout/section";
import { Button } from "@/shared/ui/button";

/** Within this many pixels of an end, the row counts as being at it. */
const EDGE_TOLERANCE_PX = 4;
/** An arrow moves the row most of a screen, so the last card shown stays in view as a cue. */
const PAGE_FRACTION = 0.9;

interface CardCarouselProps {
  title: string;
  /** Where See all leads: another page, or an action such as applying the matching filter. */
  seeAll?: { href: string } | { onSelect: () => void };
  /** The cards are placeholders for ones still loading. */
  busy?: boolean;
  /** One card per child, in order. */
  children: ReactNode;
}

interface RowEdges {
  atStart: boolean;
  atEnd: boolean;
}

/**
 * The row's ends as the reader sees them. In a right-to-left page the row starts
 * at its right edge and scrolls to negative offsets, so distances are absolute.
 */
function readEdges(row: HTMLElement): RowEdges {
  const travelled = Math.abs(row.scrollLeft);
  return {
    atStart: travelled <= EDGE_TOLERANCE_PX,
    atEnd: travelled >= row.scrollWidth - row.clientWidth - EDGE_TOLERANCE_PX,
  };
}

/**
 * A titled row of cards that scrolls sideways: swiped on touch screens, moved
 * by arrow buttons with a mouse, and snapping so a card is never left half cut
 * at the row's start. Cards keep the grid's width, so the same card fits both.
 */
export function CardCarousel({ title, seeAll, busy = false, children }: CardCarouselProps) {
  const { t } = useTranslation();
  const rowRef = useRef<HTMLDivElement>(null);
  // The server cannot measure the row, so it draws the arrows a full row has.
  const [edges, setEdges] = useState<RowEdges>({ atStart: true, atEnd: false });
  const cards = Children.toArray(children);

  const syncEdges = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const next = readEdges(row);
    setEdges(current => current.atStart === next.atStart && current.atEnd === next.atEnd ? current : next);
  }, []);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    syncEdges();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncEdges);
    observer?.observe(row);
    return () => observer?.disconnect();
  }, [cards.length, syncEdges]);

  const scrollByPage = (direction: 1 | -1) => {
    const row = rowRef.current;
    if (!row) return;
    const forward = getComputedStyle(row).direction === "rtl" ? -1 : 1;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollBy({ left: direction * forward * row.clientWidth * PAGE_FRACTION, behavior: reducedMotion ? "auto" : "smooth" });
  };

  const seeAllLabel = <>{t("common.seeAll")}<ArrowRight aria-hidden="true" className="rtl:rotate-180" /></>;
  const fits = edges.atStart && edges.atEnd;

  return (
    <Section
      title={title}
      aria-busy={busy || undefined}
      actions={<>
        {seeAll && !busy ? (
          "href" in seeAll ? (
            <Button asChild variant="link" size="sm"><NextLink href={seeAll.href}>{seeAllLabel}</NextLink></Button>
          ) : (
            <Button variant="link" size="sm" onClick={seeAll.onSelect}>{seeAllLabel}</Button>
          )
        ) : null}
        {/* Touch screens swipe the row, so only a mouse gets arrows. */}
        {fits ? null : <>
          <Button variant="outline" size="icon-sm" className="hidden pointer-fine:inline-flex" aria-label={t("common.scrollBack")} disabled={edges.atStart} onClick={() => scrollByPage(-1)}>
            <ChevronLeft className="rtl:rotate-180" />
          </Button>
          <Button variant="outline" size="icon-sm" className="hidden pointer-fine:inline-flex" aria-label={t("common.scrollForward")} disabled={edges.atEnd} onClick={() => scrollByPage(1)}>
            <ChevronRight className="rtl:rotate-180" />
          </Button>
        </>}
      </>}
    >
      {/* The vertical padding keeps a hovered card's shadow inside the scrolling box, which clips it. */}
      <div
        ref={rowRef}
        role="list"
        aria-label={title}
        onScroll={syncEdges}
        data-slot="card-carousel"
        className="no-visible-scrollbar -my-3 flex snap-x snap-mandatory gap-x-4 overflow-x-auto overscroll-x-contain py-3 sm:gap-x-5"
      >
        {cards.map((card, index) => (
          // Phones show two cards and the edge of a third; wider screens keep the grid's card width.
          <div key={isValidElement(card) && card.key !== null ? card.key : index} role="listitem" className="flex w-[calc((100%-1rem)/2.25)] min-w-0 shrink-0 snap-start min-[480px]:w-52 lg:w-56">
            {card}
          </div>
        ))}
      </div>
    </Section>
  );
}
