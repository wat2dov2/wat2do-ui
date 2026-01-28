/**
 * EventBadge Component
 * Reusable badge component for event cards
 * Extracts common Tailwind patterns
 */

import React from "react";

interface EventBadgeProps {
  text: string;
  bgClass: string;
  textClass: string;
}

export function EventBadge({ text, bgClass, textClass }: EventBadgeProps) {
  return (
    <span
      className={`font-medium text-[10px] px-2 py-0.5 rounded-xl ${bgClass} ${textClass}`}
    >
      {text}
    </span>
  );
}
