"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { useScrollDateWheel, type ScrollDateGroup } from "@/shared/hooks/useScrollDateWheel";

/** A decorative date dial that lets all pointer input pass through to the feed. */
export function ScrollDateWheel({ undatedLabel, groups }: {
  undatedLabel: string;
  groups?: readonly ScrollDateGroup[];
}) {
  const { i18n } = useTranslation();
  const { visible, rotation, dates, active } = useScrollDateWheel(groups);
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
      className="pointer-events-none fixed -left-7 top-[78%] z-30 h-40 w-16 origin-left -translate-y-1/2 scale-110 overflow-hidden transition-opacity duration-150 motion-reduce:transition-none lg:scale-150"
      style={{ opacity: visible ? 0.8 : 0 }}
    >
      <div className="absolute -left-20 top-2 size-36 rounded-full border border-border bg-surface/95 shadow-lg backdrop-blur-sm">
        <svg
          viewBox="0 0 272 272"
          className="size-full text-muted-foreground/40 motion-reduce:hidden"
          style={{ transform: `rotate(${-rotation}deg)` }}
        >
          {Array.from({ length: 60 }, (_, index) => (
            <line key={index} x1="136" y1="9" x2="136" y2={index % 5 === 0 ? 24 : 16} stroke="currentColor" strokeWidth={index % 5 === 0 ? 1.5 : 1} transform={`rotate(${index * 6} 136 136)`} />
          ))}
        </svg>
      </div>
      {[-2, -1, 0, 1, 2, 3].map(offset => {
        const index = active + offset;
        const label = labels[index];
        if (!label) return null;
        const distance = index - rotation / 36;
        if (Math.abs(distance) > 2.5) return null;
        const angle = distance * Math.PI / 5;
        return (
          <div
            key={index}
            data-active={offset === 0}
            className="absolute flex w-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center text-muted-foreground data-[active=true]:text-foreground"
            style={{ left: 4 + Math.cos(angle) * 34, top: 80 + Math.sin(angle) * 58, opacity: offset === 0 ? 1 : Math.max(0, 1 - Math.abs(distance) / 2.5) }}
            title={label.full}
          >
            <span className={offset === 0 ? "text-lg font-bold tabular-nums leading-none" : "text-[10px] font-medium tabular-nums leading-none"}>{label.day}</span>
            <span className={`mt-0.5 text-[8px] leading-tight ${offset === 0 ? "font-bold" : "font-medium"}`}>{label.month}</span>
          </div>
        );
      })}
      <span className="absolute right-0 top-1/2 h-px w-2 bg-primary" />
    </div>,
    document.body,
  );
}
