/**
 * EventInfo Component
 * Reusable component for displaying event metadata (date, time, location)
 * Extracts common Tailwind patterns
 */

import React from "react";

interface EventInfoProps {
  date: string;
  time: string;
  location: string;
}

export function EventInfo({ date, time, location }: EventInfoProps) {
  return (
    <div className="space-y-0.5 mb-0 mt-auto">
      <div className="flex gap-1.5 items-center">
        <span className="text-[11px] text-muted-foreground">{date}</span>
      </div>
      <div className="flex gap-1.5 items-center">
        <span className="text-[11px] text-muted-foreground">{time}</span>
      </div>
      <div className="flex gap-1.5 items-center">
        <span className="text-[11px] text-muted-foreground truncate">
          {location}
        </span>
      </div>
    </div>
  );
}
