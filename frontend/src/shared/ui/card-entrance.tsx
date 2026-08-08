"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * The entrance a card makes when it first appears in a grid.
 *
 * Cards rise and fade rather than snapping in, and a batch arriving together is
 * staggered so the grid fills in a sweep. Both values live here rather than at
 * each grid, so every card in the app arrives the same way.
 */
const ENTRANCE_DURATION_SECONDS = 0.5;
const STAGGER_STEP_SECONDS = 0.033;
const ENTRANCE_EASE = [0.18, 0.39, 0.14, 0.9] as const;

/**
 * How many cards a sweep runs across before starting over.
 *
 * The delay repeats on this cycle rather than growing with the index. A grid
 * scrolls further than it staggers: card two hundred does not want a six-second
 * delay, and giving every card past some ceiling the same delay would land a
 * whole screen at once. A cycle of roughly two rows keeps each batch arriving
 * as a sweep however far down the page the reader is.
 */
const STAGGER_CYCLE = 8;

interface CardEntranceProps {
  children: ReactNode;
  /** Position in the grid; only decides this card's share of the stagger. */
  index: number;
  className?: string;
  /** Carried by this element, so a grid needs no separate wrapper for it. */
  role?: string;
}

/**
 * A card arrives when it is scrolled into view, not when it is rendered.
 *
 * Animating on mount meant the whole list ran at once - so everything below
 * the fold had finished long before the reader got there, and scrolling caught
 * at most the tail of it. Tying the entrance to the viewport instead means each
 * card is animating exactly when it is being looked at, and it applies equally
 * to the first screen and to every batch paged in afterwards.
 *
 * `once` keeps it to a single arrival: cards do not replay every time they pass
 * back through the viewport.
 */
export function CardEntrance({
  children,
  index,
  className,
  role,
}: CardEntranceProps) {
  const prefersReducedMotion = useReducedMotion();

  // This element is the grid cell, so it stretches to the row's height and the
  // card inside can fill it. Anything nested in between would be the auto-height
  // box a card's `h-full` measured itself against, leaving a short row ragged.
  if (prefersReducedMotion) {
    return (
      <div className={className} role={role}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={className}
      role={role}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1 }}
      transition={{
        duration: ENTRANCE_DURATION_SECONDS,
        delay: (index % STAGGER_CYCLE) * STAGGER_STEP_SECONDS,
        ease: ENTRANCE_EASE,
      }}
    >
      {children}
    </motion.div>
  );
}
