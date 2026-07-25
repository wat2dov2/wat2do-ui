import type { CSSProperties, HTMLAttributes } from "react";

import { cn } from "@/shared/lib/utils";

type LightRay = {
  id: string;
  left: number;
  rotate: number;
  width: number;
  swing: number;
  delayFactor: number;
  durationFactor: number;
};

/** Deterministic values keep the server and client ray layouts identical. */
function pseudoRandom(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const rays: LightRay[] = Array.from({ length: 7 }, (_, index) => ({
  id: `${index}-${Math.round((8 + pseudoRandom(index * 1.1 + 0.2) * 84) * 10)}`,
  left: 8 + pseudoRandom(index * 1.1 + 0.2) * 84,
  rotate: -28 + pseudoRandom(index * 2.3 + 0.4) * 56,
  width: 160 + pseudoRandom(index * 3.7 + 0.6) * 160,
  swing: 0.8 + pseudoRandom(index * 4.9 + 0.8) * 1.8,
  delayFactor: (index / 7) * 0.45,
  durationFactor: 0.75 + pseudoRandom(index * 5.1 + 1) * 0.5,
}));

/**
 * Decorative event-page rays adapted from the prior Magic UI implementation.
 * Colour and motion are owned exclusively by the --event-light-rays-* tokens.
 */
export function LightRays({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("event-light-rays", className)} {...props}>
      <div aria-hidden="true" className="event-light-rays__ambient event-light-rays__ambient--left" />
      <div aria-hidden="true" className="event-light-rays__ambient event-light-rays__ambient--right" />
      {rays.map((ray, index) => (
        <div
          key={ray.id}
          aria-hidden="true"
          className="event-light-rays__ray"
          style={
            {
              "--event-light-ray-delay-index": index,
              "--event-light-ray-left": `${ray.left}%`,
              "--event-light-ray-rotation": `${ray.rotate}deg`,
              "--event-light-ray-swing": `${ray.swing}deg`,
              "--event-light-ray-width": `${ray.width}px`,
              "--event-light-ray-delay-factor": ray.delayFactor,
              "--event-light-ray-duration-factor": ray.durationFactor,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
