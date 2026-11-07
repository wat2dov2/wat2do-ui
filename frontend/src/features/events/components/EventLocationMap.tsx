"use client";

import { isVirtualLocation } from "@/shared/utils/event";
import { useIntersectionObserver } from "@/shared/hooks/useIntersectionObserver";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";

/** The embed is about 460 KB of Google Maps code, so it loads only as it nears the screen. */
const MAP_LOAD_MARGIN = "300px";
const MAP_HEIGHT_PX = 256;

interface EventLocationMapProps {
  location?: string | null;
  school?: string | null;
}

export function EventLocationMap({ location, school }: EventLocationMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const physicalLocation = location?.trim();
  const { getSchoolName } = useSchoolDirectory();
  const { ref, hasIntersected } = useIntersectionObserver<HTMLDivElement>({
    rootMargin: MAP_LOAD_MARGIN,
    enabled: Boolean(physicalLocation && apiKey),
  });

  if (!physicalLocation || isVirtualLocation(physicalLocation) || !apiKey) {
    return null;
  }

  const schoolName = school?.trim() ? getSchoolName(school) : null;
  const query = schoolName
    ? `${physicalLocation}, ${schoolName}`
    : physicalLocation;
  const src = `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodeURIComponent(query)}`;

  // The box is reserved from the first paint, so the page never moves when the map arrives.
  return (
    <div
      ref={ref}
      data-slot="event-location-map"
      className="mt-2 w-full overflow-hidden rounded-lg bg-muted"
      style={{ height: MAP_HEIGHT_PX }}
    >
      {hasIntersected ? (
        <iframe
          title={physicalLocation}
          src={src}
          height={MAP_HEIGHT_PX}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="block h-full w-full border-0"
          allowFullScreen
        />
      ) : null}
    </div>
  );
}
