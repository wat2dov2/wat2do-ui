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
 * How far into a grid the stagger keeps growing.
 *
 * Without a ceiling the hundredth card would sit blank for three seconds
 * waiting for its turn. Past this point every remaining card shares the last
 * delay and comes in together, which is what a reader scrolled far enough to
 * see them would expect anyway.
 */
const MAX_STAGGER_STEPS = 12;

interface CardEntranceProps {
  children: ReactNode;
  /** Position in the grid; only decides this card's share of the stagger. */
  index: number;
  className?: string;
}

/**
 * Only mounting animates. `initial` runs when the element mounts and not again,
 * so re-ordering or re-filtering a grid leaves the cards React reuses exactly
 * where they are - a search keystroke does not make the whole page twitch, and
 * only genuinely new cards move.
 */
export function CardEntrance({ children, index, className }: CardEntranceProps) {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: ENTRANCE_DURATION_SECONDS,
        delay: Math.min(index, MAX_STAGGER_STEPS) * STAGGER_STEP_SECONDS,
        ease: ENTRANCE_EASE,
      }}
    >
      {children}
    </motion.div>
  );
}
