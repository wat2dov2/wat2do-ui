import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { COUNTER_ANIMATION_DURATION_MS } from "@/shared/constants/ui";

interface EventCountProps {
  count: number;
}

export function EventCount({ count }: EventCountProps) {
  const { t } = useTranslation();
  const [displayed, setDisplayed] = useState(count);
  const previous = useRef(count);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // If count didn't change, do nothing
    if (count === previous.current) return;

    const start = previous.current;
    const end = count;
    const duration = COUNTER_ANIMATION_DURATION_MS;
    const startTime = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out for a more natural feel
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(start + (end - start) * eased);
      setDisplayed(value);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        previous.current = end;
      }
    };

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [count]);

  return (
    <span className="font-bold text-xl text-foreground">
      {displayed} {displayed === 1 ? t("common.event") : t("common.events")}
    </span>
  );
}
