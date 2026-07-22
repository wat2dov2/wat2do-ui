import { isVirtualLocation } from "@/features/events/lib/isVirtualLocation";

interface EventLocationMapProps {
  location?: string | null;
  school?: string | null;
}

export function EventLocationMap({ location, school }: EventLocationMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  const physicalLocation =
    location && location.trim() && !isVirtualLocation(location) ? location : null;
  const query = physicalLocation
    ? `${physicalLocation}, ${school ?? ""}`
    : school?.trim() || null;

  if (!query || !apiKey) {
    return null;
  }

  const src = `https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=${encodeURIComponent(query)}`;

  return (
    <iframe
      title={physicalLocation ?? query}
      src={src}
      height={256}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      className="mt-2 w-full rounded-lg border-0"
      allowFullScreen
    />
  );
}
