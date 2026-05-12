/**
 * EventImage Component
 * Reusable image component for event cards
 * Extracts common Tailwind patterns for image display
 */

import React from "react";
import { ImageOff } from "lucide-react";
import { LazyImage } from "@/shared/ui/lazy-image";
import type { Event } from "@/shared/types";

interface EventImageProps {
  event: Event;
  isPromoted: boolean;
}

export function EventImage({ event, isPromoted }: EventImageProps) {
  const fallbackBg = isPromoted
    ? "bg-gradient-to-br from-yellow-100 to-yellow-50"
    : "bg-gradient-to-br from-muted to-muted/80";

  return (
    <>
      <LazyImage
        src={event.imageUrl || event.source_image_url}
        alt={event.title}
        className="absolute inset-0 w-full h-full"
        fallback={
          <div
            className={`absolute inset-0 ${fallbackBg} flex items-center justify-center`}
          >
            <ImageOff className="size-8 text-muted-foreground/40" />
          </div>
        }
        placeholder={
          <div className={`absolute inset-0 ${fallbackBg} animate-pulse`} />
        }
      />
    </>
  );
}
