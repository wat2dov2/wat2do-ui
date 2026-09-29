"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { useScrollDateWheel } from "@/shared/hooks/useScrollDateWheel";

/** A pointer-transparent half dial follows the feed without taking over scrolling. */
export function ScrollDateWheel({ undatedLabel }: { undatedLabel: string }) {
  const { i18n } = useTranslation();
  const { visible, rotation, dates, active } = useScrollDateWheel();
  const locale = i18n.language || "en";
  const labels = useMemo(() => {
    const dayFormat = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "UTC" });
    const monthFormat = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
    const fullFormat = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" });
    return dates.map(value => {
      if (!value) return { day: "", month: undatedLabel, full: undatedLabel };
      const date = new Date(value + "T00:00:00Z");
      return { day: dayFormat.format(date), month: monthFormat.format(date), full: fullFormat.format(date) };
    });
  }, [dates, locale, undatedLabel]);
  if (typeof document === "undefined" || dates.length === 0) return null;

  return createPortal(
    <div
      data-slot="scroll-date-wheel"
      data-visible={visible}
      data-date={dates[active] ?? ""}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-1/2 z-30 h-72 w-32 -translate-y-1/2 overflow-hidden transition-opacity duration-300 motion-reduce:transition-none"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div className="absolute -left-36 top-2 size-68 rounded-full border border-border bg-surface/95 shadow-lg backdrop-blur-sm">
        <svg
          viewBox="0 0 272 272"
          className="size-full text-muted-foreground/40 motion-reduce:hidden"
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {Array.from({ length: 60 }, (_, index) => (
            <line key={index} x1="136" y1="9" x2="136" y2={index % 5 === 0 ? 24 : 16} stroke="currentColor" strokeWidth={index % 5 === 0 ? 1.5 : 1} transform={`rotate(${index * 6} 136 136)`} />
          ))}
        </svg>
      </div>
      {[-2, -1, 0, 1, 2].map(offset => {
        const label = labels[active + offset];
        if (!label) return null;
        const angle = offset * Math.PI / 5;
        return (
          <div
            key={offset}
            data-active={offset === 0}
            className="absolute flex w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center text-muted-foreground data-[active=true]:text-foreground"
            style={{ left: 12 + Math.cos(angle) * 60, top: 144 + Math.sin(angle) * 110, opacity: offset === 0 ? 1 : Math.abs(offset) === 1 ? 0.55 : 0.25 }}
            title={label.full}
          >
            <span className={offset === 0 ? "text-3xl font-bold tabular-nums leading-none" : "text-sm font-medium tabular-nums leading-none"}>{label.day}</span>
            <span className="mt-1 text-[10px] font-medium leading-tight">{label.month}</span>
          </div>
        );
      })}
      <span className="absolute right-0 top-1/2 h-px w-3 bg-primary" />
    </div>,
    document.body,
  );
}
