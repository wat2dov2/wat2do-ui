"use client";

import { useState, type ReactNode } from "react";
import { AnimatePresence, MotionConfig, m, type Variants } from "framer-motion";
import { cn } from "@/shared/lib/utils";

/** A step forward (Next) is 1, a step back is -1. */
type Travel = 1 | -1;

/** The next step lies on the reading side: to the right, or to the left in a right-to-left page. */
function forwardSide(): number {
  return document.documentElement.dir === "rtl" ? -1 : 1;
}

/**
 * The new step comes in from the side the person is heading while the last
 * one leaves by the other, so Back visibly goes back. Both travel as one move.
 */
const STEP_SLIDE: Variants = {
  enter: (travel: Travel) => ({ x: `${travel * forwardSide() * 100}%` }),
  center: { x: "0%" },
  exit: (travel: Travel) => ({ x: `${-travel * forwardSide() * 100}%` }),
};

/** A move that starts and ends on screen: --motion-max on --ease-in-out-ui (styles/motion.css). */
const STEP_SLIDE_TIMING = { duration: 0.3, ease: [0.65, 0, 0.35, 1] } as const;

interface StepTransitionProps {
  /** The current step's place in the flow; a higher one is a step forward. */
  step: number;
  children: ReactNode;
}

/**
 * A stepper's current step. Changing step slides the steps in the direction of
 * travel instead of crossfading them; with reduced motion they swap in place.
 * It renders framer-motion's `m`, so it sits inside the page's `LazyMotion`.
 */
export function StepTransition({ step, children }: StepTransitionProps) {
  const [shown, setShown] = useState<{ step: number; travel: Travel; moving: boolean }>({
    step,
    travel: 1,
    moving: false,
  });
  if (shown.step !== step) {
    setShown({ step, travel: step > shown.step ? 1 : -1, moving: true });
  }

  return (
    <MotionConfig reducedMotion="user">
      {/* While steps slide, their box hides what is past its sides, so the page never
          scrolls sideways; at rest nothing is clipped. */}
      <div className={cn("relative w-full", shown.moving && "overflow-x-clip")}>
        <AnimatePresence
          mode="popLayout"
          initial={false}
          custom={shown.travel}
          onExitComplete={() => setShown((current) => ({ ...current, moving: false }))}
        >
          <m.div
            key={step}
            custom={shown.travel}
            variants={STEP_SLIDE}
            initial="enter"
            animate="center"
            exit="exit"
            transition={STEP_SLIDE_TIMING}
            className="w-full"
          >
            {children}
          </m.div>
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
